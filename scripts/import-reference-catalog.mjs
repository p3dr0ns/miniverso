import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { command, isEntrypoint, ROOT, wrangler } from "./lib.mjs";

const SOURCE = join(ROOT, "data", "base-de-dados-hw.csv");
const OUTPUT = join(ROOT, ".wrangler", "catalog-reference-import.sql");

export function parseCsv(source) {
  const rows = []; let row = [], field = "", quoted = false;
  source = source.replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') { field += '"'; index += 1; } else quoted = !quoted;
    } else if (char === "," && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field); if (row.some((value) => value.trim())) rows.push(row); row = []; field = "";
    } else field += char;
  }
  row.push(field); if (row.some((value) => value.trim())) rows.push(row);
  if (quoted) throw new Error("O CSV possui aspas não fechadas.");
  return rows;
}

const clean = (value, max) => String(value || "").trim().slice(0, max);
const sql = (value) => `'${String(value).replaceAll("'", "''")}'`;

export async function prepareCatalog(source) {
  source ??= await readFile(SOURCE, "utf8");
  const rows = parseCsv(source), expected = ["nome", "fabricante", "escala", "cor", "codigo", "ano", "linha", "serie"];
  const headers = rows.shift()?.map((value) => value.trim().toLowerCase()) || [];
  if (headers.join("|") !== expected.join("|")) throw new Error(`Cabeçalho inesperado: ${headers.join(", ")}`);
  const byCode = new Map(), rejected = [];
  for (const [offset, values] of rows.entries()) {
    const [name, maker, scale, color, rawCode, releaseYear, category, series] = values;
    const code = clean(rawCode, 40).toUpperCase();
    if (!code || !clean(name, 90)) { rejected.push(offset + 2); continue; }
    const normalizedScale = clean(scale, 20) === "02:04" ? "1:64" : clean(scale, 20);
    const item = { name: clean(name, 90), maker: clean(maker, 60), scale: normalizedScale, color: clean(color, 80), releaseYear: clean(releaseYear, 4), category: clean(category, 80), series: clean(series, 90) };
    Object.keys(item).forEach((key) => { if (!item[key]) delete item[key]; });
    if (!byCode.has(code)) byCode.set(code, []);
    const variants = byCode.get(code);
    if (!variants.some((value) => JSON.stringify(value) === JSON.stringify(item))) variants.push(item);
  }
  const duplicates = [...byCode].filter(([, variants]) => variants.length > 1);
  return { byCode, rejected, duplicates, sourceRows: rows.length };
}

export async function importCatalog() {
  const { byCode, rejected, duplicates, sourceRows } = await prepareCatalog();
  await mkdir(join(ROOT, ".wrangler"), { recursive: true });
  const now = Math.floor(Date.now() / 1000), statements = [];
  for (const [code, variants] of byCode) {
    const primary = variants[0];
    statements.push(`INSERT INTO catalog_reference(code,data_json,variants_json,images_json,source_name,updated_at) VALUES(${sql(code)},${sql(JSON.stringify(primary))},${sql(JSON.stringify(variants))},'[]','Base Miniverso 2015–2026',${now}) ON CONFLICT(code) DO UPDATE SET data_json=excluded.data_json,variants_json=excluded.variants_json,source_name=excluded.source_name,updated_at=excluded.updated_at;`);
  }
  await writeFile(OUTPUT, `${statements.join("\n")}\n`, "utf8");
  console.log(`CSV validado: ${sourceRows} linhas, ${byCode.size} códigos, ${duplicates.length} códigos com variantes, ${rejected.length} linhas rejeitadas.`);
  await wrangler(["d1", "execute", "AUTH_DB", "--remote", "--file", OUTPUT], { environment: { CI: "true" }, nonInteractive: true, omitSettings: true });
  console.log("Catálogo de referência importado no D1.");
}

if (isEntrypoint(import.meta.url)) await command(importCatalog);
