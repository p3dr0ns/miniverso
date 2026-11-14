import { buildFrontend, command, isEntrypoint, readLocalSettings, validateSettings, wrangler } from "./lib.mjs";

export async function dev() {
  validateSettings(await readLocalSettings());
  await buildFrontend();
  console.log("Preparando o banco local...");
  await wrangler(["d1", "migrations", "apply", "AUTH_DB", "--local"], {
    nonInteractive: true,
    environment: { CI: "true" },
    omitSettings: true
  });
  console.log("\nAbra http://localhost:8787 para usar o site e a API juntos. Ctrl+C encerra o servidor.");
  await wrangler(["dev", "--ip", "127.0.0.1", "--port", "8787"], { omitSettings: true });
}

if (isEntrypoint(import.meta.url)) await command(dev);
