import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { access, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve, delimiter } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { createInterface } from "node:readline/promises";
import { emitKeypressEvents } from "node:readline";

export const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const SETTINGS_PATH = join(ROOT, ".dev.vars");
export const SETTINGS_KEYS = ["AUTH_SECRET"];
export const PLACEHOLDER_DATABASE_ID = "00000000-0000-0000-0000-000000000000";

export function assertNodeVersion() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major < 24) throw new Error("Instale Node.js 24 ou superior antes de continuar.");
}

export async function readLocalSettings(path = SETTINGS_PATH) {
  try {
    const source = (await readFile(path, "utf8")).replace(/^\uFEFF/, "");
    const seenKeys = new Set();
    for (const line of source.split(/\r?\n/)) {
      if (!line.trim() || line.trimStart().startsWith("#")) continue;
      const assignment = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!assignment || seenKeys.has(assignment[1])) throw new Error("invalid_settings");
      seenKeys.add(assignment[1]);
      const value = assignment[2];
      if ((value.startsWith("'") && !/^'[^']*'\s*(?:#.*)?$/.test(value))
        || (value.startsWith('"') && !/^"[^"]*"\s*(?:#.*)?$/.test(value))) {
        throw new Error("invalid_settings");
      }
    }
    return parseEnv(source);
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw new Error("O arquivo .dev.vars não pôde ser lido ou está malformado. Use uma variável por linha, sem duplicatas; o arquivo foi preservado.");
  }
}

export function validateSettings(values) {
  for (const key of SETTINGS_KEYS) {
    if (typeof values[key] !== "string" || !values[key].trim()) throw new Error(`Falta configurar ${key}. Execute npm run setup.`);
  }
  if (values.AUTH_SECRET.trim().length < 32 || values.AUTH_SECRET.startsWith("gere_um_segredo")) {
    throw new Error("AUTH_SECRET precisa ser um segredo próprio com pelo menos 32 caracteres. O exemplo não pode ser usado.");
  }
  for (const [key, value] of Object.entries(values)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== "string" || /[\r\n\0$]/.test(value)) {
      throw new Error(`Revise o formato da variável ${key}. Quebras de linha e o caractere $ não são aceitos neste arquivo.`);
    }
    if (value.includes("'") && (value.includes('"') || value.includes("\\"))) {
      throw new Error(`A variável ${key} contém uma combinação de aspas incompatível. O arquivo foi preservado.`);
    }
  }
  return values;
}

export function mergeSettings(saved, environment = process.env) {
  saved = { ...saved };
  if (saved.AUTH_SECRET?.startsWith("gere_um_segredo")) delete saved.AUTH_SECRET;
  if (saved.AUTH_SECRET && environment.AUTH_SECRET && saved.AUTH_SECRET !== environment.AUTH_SECRET) {
    throw new Error("AUTH_SECRET do ambiente difere do arquivo existente. Remova essa variável do ambiente para preservar o segredo atual.");
  }
  const result = { ...saved };
  result.AUTH_SECRET = saved.AUTH_SECRET || environment.AUTH_SECRET || randomBytes(32).toString("base64url");
  return result;
}

export function serializeSettings(values) {
  validateSettings(values);
  const quote = (value) => value.includes("'") ? `"${value}"` : `'${value}'`;
  return "# Credenciais locais do servidor. Este arquivo fica fora do Git.\n"
    + Object.entries(values).map(([key, value]) => `${key}=${quote(value)}`).join("\n") + "\n";
}

export async function atomicWrite(path, contents, mode = 0o600) {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, contents, { flag: "wx", mode });
    await rename(temporaryPath, path);
  } finally {
    await unlink(temporaryPath).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
}

export async function promptText(label, defaultValue = "") {
  if (!process.stdin.isTTY) throw new Error("Use um terminal interativo ou configure as variáveis de ambiente antes de executar npm run setup.");
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  const controller = new AbortController();
  readline.once("close", () => controller.abort());
  readline.once("SIGINT", () => controller.abort());
  try {
    const answer = await readline.question(`${label}${defaultValue ? ` [${defaultValue}]` : ""}: `, { signal: controller.signal });
    return answer.trim() || defaultValue;
  } catch {
    throw new Error("Configuração cancelada. O arquivo anterior foi preservado.");
  } finally {
    readline.close();
  }
}

export function promptSecret(label, defaultValue = "") {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("Abra um terminal interativo para informar a chave ou defina BREVO_API_KEY no ambiente.");
  }
  return new Promise((resolveAnswer, reject) => {
    const input = process.stdin;
    const wasRaw = Boolean(input.isRaw);
    const wasPaused = input.isPaused();
    let answer = "";
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      input.removeListener("keypress", onKeypress);
      input.removeListener("end", onEnd);
      input.setRawMode(wasRaw);
      if (wasPaused) input.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolveAnswer(answer.trim() || defaultValue);
    };
    const onEnd = () => finish(new Error("Entrada encerrada. O arquivo anterior foi preservado."));
    const onKeypress = (text, key = {}) => {
      if (key.ctrl && (key.name === "c" || key.name === "d")) return finish(new Error("Configuração cancelada. O arquivo anterior foi preservado."));
      if (key.name === "return" || key.name === "enter") return finish();
      if (key.name === "backspace" || key.name === "delete") {
        answer = [...answer].slice(0, -1).join("");
      } else if (text && !key.ctrl && !key.meta && !/[\u0000-\u001f\u007f]/.test(text)) {
        answer += text;
      }
    };
    emitKeypressEvents(input);
    input.setRawMode(true);
    input.on("keypress", onKeypress);
    input.once("end", onEnd);
    process.stdout.write(`${label}${defaultValue ? " [Enter mantém a chave atual]" : ""} (entrada oculta): `);
    input.resume();
  });
}

export function childEnvironment(overrides = {}, { omitSettings = false } = {}) {
  const environment = { ...process.env, ...overrides, WRANGLER_SEND_METRICS: "false" };
  const pathKey = Object.keys(environment).find((key) => key.toLowerCase() === "path") || "PATH";
  environment[pathKey] = `${dirname(process.execPath)}${delimiter}${environment[pathKey] || ""}`;
  if (omitSettings) for (const key of SETTINGS_KEYS) delete environment[key];
  return environment;
}

export async function runTool(relativeEntry, args, { capture = false, allowFailure = false, environment = {}, nonInteractive = false, omitSettings = false } = {}) {
  const entry = join(ROOT, relativeEntry);
  try { await access(entry); } catch { throw new Error("As dependências não estão instaladas. Execute npm install."); }
  const result = await new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [entry, ...args], {
      cwd: ROOT,
      env: childEnvironment(environment, { omitSettings }),
      windowsHide: true,
      shell: false,
      stdio: [nonInteractive || capture ? "ignore" : "inherit", capture ? "pipe" : "inherit", capture ? "pipe" : "inherit"]
    });
    let stdout = "";
    let stderr = "";
    if (capture) {
      child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
      child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    }
    child.once("error", () => reject(new Error("Não foi possível iniciar a ferramenta de publicação.")));
    child.once("close", (code, signal) => resolveResult({ code: code ?? 1, signal, stdout, stderr }));
  });
  if (result.code !== 0 && !allowFailure) throw new Error(`A etapa ${args[0] || "build"} falhou. Confira a mensagem da ferramenta e tente novamente.`);
  return result;
}

export const wrangler = (args, options) => runTool("node_modules/wrangler/bin/wrangler.js", args, options);
export const buildFrontend = () => runTool("node_modules/vite/bin/vite.js", ["build"], { omitSettings: true });

export function parseToolJson(result) {
  for (const text of [result.stdout, result.stderr]) {
    try { return JSON.parse(text.trim()); } catch { /* A ferramenta pode escrever um aviso no outro canal. */ }
  }
  throw new Error("Não foi possível ler a resposta da Cloudflare. Confira sua conexão e as permissões da conta.");
}

export function isEntrypoint(url) {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(url);
}

export async function command(task) {
  try {
    assertNodeVersion();
    await task();
  } catch (error) {
    console.error(`\n${error.message}`);
    process.exitCode = 1;
  }
}
