import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { command, isEntrypoint, ROOT, wrangler } from "./lib.mjs";
import { parseCsv } from "./import-reference-catalog.mjs";

const YEARS = Array.from({ length: 12 }, (_, index) => 2015 + index);
const RAW_SOURCE = join(ROOT, "data", "base-de-dados-hw.csv");
const OVERRIDES_SOURCE = join(ROOT, "data", "catalog-overrides.json");
const OUTPUT = join(ROOT, "data", "catalogo-validado.json");
const REPORT = join(ROOT, "data", "CATALOG_VALIDATION_REPORT.md");
const SQL_OUTPUT = join(ROOT, ".wrangler", "catalog-wiki-validation.sql");
const API = "https://hotwheels.fandom.com/api.php";

const decode = (value) => String(value || "").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/&#x([a-f0-9]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16))).replaceAll("&amp;", "&").replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&#39;", "'").replaceAll("&nbsp;", " ");
const text = (value) => decode(String(value || "").replace(/<br\s*\/?\s*>/gi, " ").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const sql = (value) => `'${String(value ?? "").replaceAll("'", "''")}'`;
const cleanImage = (value) => String(value || "").replace(/\/revision\/latest\/scale-to-width-down\/\d+(\?[^#]*)?$/i, "/revision/latest$1");
const normalize = (value) => text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

async function fetchYear(year) {
  const url = new URL(API); url.search = new URLSearchParams({ action: "parse", page: `List_of_${year}_Hot_Wheels`, prop: "text", format: "json", origin: "*" });
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "Miniverso/1.0 catalog audit" }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Falha ao consultar ${year}: HTTP ${response.status}`);
  const html = (await response.json())?.parse?.text?.["*"]; if (!html) throw new Error(`A lista de ${year} não foi encontrada.`);
  return html;
}

function headingBefore(html, index) {
  const headings = [...html.slice(0, index).matchAll(/<h2[^>]*>[\s\S]*?<\/h2>/gi)];
  return text(headings.at(-1)?.[0] || "Mainline").replace(/\[\s*(?:edit)?\s*\]$/i, "").trim();
}

export function parseYear(html, year) {
  const items = [];
  for (const match of html.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/gi)) {
    const cells = [...match[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1]);
    if (cells.length < 4) continue;
    const code = text(cells[0]).toUpperCase(), collector = text(cells[1]).match(/\d{1,3}/)?.[0] || "", name = text(cells[2]).replace(/\s*\((?:2nd|3rd|4th) Color\)\s*$/i, "").trim(), series = text(cells[3]);
    if (!/^[A-Z0-9][A-Z0-9 .\/-]{2,39}$/.test(code) || !/[A-Z]/.test(code) || !name || /toy\s*#/i.test(code)) continue;
    const imageMatch = match[0].match(/(?:href|data-src)=["'](https:\/\/static\.wikia\.nocookie\.net\/[^"']+)/i);
    items.push({ code, name, maker: "Hot Wheels", scale: "1:64", releaseYear: String(year), category: headingBefore(html, match.index), series, ...(collector ? { seriesNumber: `${collector}/250` } : {}), ...(imageMatch ? { photo: cleanImage(decode(imageMatch[1])) } : {}), sourceName: "Hot Wheels Wiki", sourceUrl: `https://hotwheels.fandom.com/wiki/List_of_${year}_Hot_Wheels`, license: "CC BY-SA 3.0" });
  }
  return items;
}

function rawByCode(source) {
  const rows = parseCsv(source); rows.shift(); const result = new Map();
  for (const row of rows) { const code = String(row[4] || "").trim().toUpperCase(); if (code && !result.has(code)) result.set(code, { name: row[0], year: row[5], series: row[7] }); }
  return result;
}

export async function validateCatalog({ apply = false } = {}) {
  const raw = rawByCode(await readFile(RAW_SOURCE, "utf8"));
  const overrides = JSON.parse(await readFile(OVERRIDES_SOURCE, "utf8"));
  const yearly = await Promise.all(YEARS.map(async (year) => ({ year, items: parseYear(await fetchYear(year), year) })));
  const byCode = new Map(); for (const { items } of yearly) for (const item of items) { if (!byCode.has(item.code)) byCode.set(item.code, []); const variants = byCode.get(item.code); if (!variants.some((value) => value.releaseYear === item.releaseYear && normalize(value.name) === normalize(item.name))) variants.push(item); }
  for (const item of overrides.items || []) byCode.set(item.code.toUpperCase(), [item]);
  const changed = [], missing = [];
  for (const [code, variants] of byCode) { const before = raw.get(code), primary = variants[0]; if (!before) missing.push(code); else if (normalize(before.name) !== normalize(primary.name) || before.year !== primary.releaseYear) changed.push({ code, before: `${before.name} (${before.year})`, after: `${primary.name} (${primary.releaseYear})` }); }
  const validated = [...byCode].map(([code, variants]) => ({ code, primary: variants[0], variants, images: [...new Set(variants.map((item) => item.photo).filter(Boolean))] })).sort((a, b) => a.code.localeCompare(b.code));
  await writeFile(OUTPUT, `${JSON.stringify({ generatedAt: new Date().toISOString(), years: YEARS, source: "Hot Wheels Wiki annual lists (CC BY-SA 3.0)", items: validated })}\n`, "utf8");
  const lines = ["# Relatório de validação do catálogo", "", `Gerado em ${new Date().toISOString()}.`, "", `- Códigos validados: ${validated.length}`, `- Registros antigos divergentes: ${changed.length}`, `- Códigos validados ausentes na base antiga: ${missing.length}`, "", "## Divergências corrigidas", "", "| Código | Antes | Depois |", "| --- | --- | --- |", ...changed.map((item) => `| ${item.code} | ${item.before.replaceAll("|", "\\|")} | ${item.after.replaceAll("|", "\\|")} |`)];
  await writeFile(REPORT, `${lines.join("\n")}\n`, "utf8");
  if (apply) {
    await mkdir(join(ROOT, ".wrangler"), { recursive: true }); const now = Math.floor(Date.now() / 1000);
    const statements = validated.map(({ code, primary, variants, images }) => `INSERT INTO catalog_reference(code,data_json,variants_json,images_json,source_name,source_url,updated_at) VALUES(${sql(code)},${sql(JSON.stringify(primary))},${sql(JSON.stringify(variants))},${sql(JSON.stringify(images))},${sql(primary.sourceName)},${sql(primary.sourceUrl)},${now}) ON CONFLICT(code) DO UPDATE SET data_json=excluded.data_json,variants_json=excluded.variants_json,images_json=excluded.images_json,source_name=excluded.source_name,source_url=excluded.source_url,updated_at=excluded.updated_at;`);
    const chunkSize = 400;
    for (let offset = 0; offset < statements.length; offset += chunkSize) {
      const file = SQL_OUTPUT.replace(/\.sql$/, `-${String(offset / chunkSize + 1).padStart(2, "0")}.sql`), chunk = statements.slice(offset, offset + chunkSize);
      if (offset === 0) chunk.unshift("DELETE FROM catalog_reference;");
      await writeFile(file, `${chunk.join("\n")}\n`, "utf8");
      await wrangler(["d1", "execute", "AUTH_DB", "--remote", "--file", file], { environment: { CI: "true" }, nonInteractive: true, omitSettings: true });
      console.log(`Lote ${offset / chunkSize + 1}/${Math.ceil(statements.length / chunkSize)} importado.`);
    }
  }
  console.log(`Validados ${validated.length} códigos; ${changed.length} divergências; ${missing.length} novos códigos.${apply ? " Banco atualizado." : ""}`);
  return { validated, changed, missing };
}

if (isEntrypoint(import.meta.url)) await command(() => validateCatalog({ apply: process.argv.includes("--apply") }));
