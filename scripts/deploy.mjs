import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { atomicWrite, buildFrontend, command, isEntrypoint, parseToolJson, PLACEHOLDER_DATABASE_ID, promptText, readLocalSettings, ROOT, validateSettings, wrangler } from "./lib.mjs";

async function selectAccount(config) {
  const status = await wrangler(["whoami", "--json"], { capture: true, allowFailure: true, omitSettings: true });
  const identity = parseToolJson(status);
  if (status.code !== 0 || !identity.loggedIn) {
    throw new Error("Conecte sua conta Cloudflare com npm exec wrangler login e depois execute npm run deploy novamente.");
  }
  const accounts = identity.accounts || [];
  const configuredId = process.env.CLOUDFLARE_ACCOUNT_ID || config.account_id;
  if (configuredId) {
    if (!/^[a-f0-9]{32}$/i.test(configuredId) || !accounts.some((account) => account.id === configuredId)) {
      throw new Error("A conta Cloudflare configurada não está disponível no login atual. Confira CLOUDFLARE_ACCOUNT_ID e account_id antes de publicar.");
    }
    return configuredId;
  }
  if (accounts.length === 1) return accounts[0].id;
  if (!accounts.length) throw new Error("Seu login não disponibilizou uma conta Cloudflare. Confira as permissões de Workers e D1.");
  console.log("Escolha a conta Cloudflare que hospedará o Miniverso:");
  accounts.forEach((account, index) => console.log(`${index + 1}. ${account.name} (${account.id})`));
  const selection = Number(await promptText("Número da conta"));
  if (!Number.isInteger(selection) || !accounts[selection - 1]) throw new Error("Seleção inválida. Nenhuma publicação foi feita.");
  return accounts[selection - 1].id;
}

async function ensureDatabase(config, environment) {
  const binding = config.d1_databases?.find((item) => item.binding === "AUTH_DB");
  if (!binding?.database_name) throw new Error("Falta o binding AUTH_DB em wrangler.json.");
  const listing = parseToolJson(await wrangler(["d1", "list", "--json"], { capture: true, environment, omitSettings: true }));
  if (!Array.isArray(listing)) throw new Error("A Cloudflare não retornou a lista esperada de bancos D1.");
  let database = listing.find((item) => item.uuid === binding.database_id);
  if (binding.database_id && binding.database_id !== PLACEHOLDER_DATABASE_ID) {
    if (!database) throw new Error("O banco configurado não foi encontrado nesta conta. O script não substituirá esse banco automaticamente.");
  } else {
    database = listing.find((item) => item.name === binding.database_name);
    if (!database) {
      console.log("Criando o banco de autenticação na Cloudflare...");
      await wrangler(["d1", "create", binding.database_name], { environment, omitSettings: true });
      database = parseToolJson(await wrangler(["d1", "info", binding.database_name, "--json"], { capture: true, environment, omitSettings: true }));
    }
    if (!/^[a-f0-9-]{36}$/i.test(database?.uuid || "")) throw new Error("A Cloudflare não retornou um identificador válido para o banco.");
    binding.database_id = database.uuid;
  }
}

export async function deploy() {
  validateSettings(await readLocalSettings());
  const configPath = join(ROOT, "wrangler.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  if (!config.name || config.main !== "server/worker.js") throw new Error("Confira o nome e a entrada do Worker em wrangler.json.");
  const accountId = await selectAccount(config);
  const environment = { CLOUDFLARE_ACCOUNT_ID: accountId };
  await buildFrontend();
  await ensureDatabase(config, environment);
  config.account_id = accountId;
  await atomicWrite(configPath, `${JSON.stringify(config, null, 2)}\n`, 0o644);
  console.log("Aplicando as migrações do banco de autenticação...");
  await wrangler(["d1", "migrations", "apply", "AUTH_DB", "--remote"], {
    environment: { ...environment, CI: "true" },
    nonInteractive: true,
    omitSettings: true
  });
  console.log("Publicando o site e o servidor com os segredos protegidos...");
  await wrangler(["deploy", "--secrets-file", ".dev.vars"], { environment, omitSettings: true });
  console.log("\nUse o endereço HTTPS informado acima para solicitar um código e entrar no Miniverso.");
}

if (isEntrypoint(import.meta.url)) await command(deploy);
