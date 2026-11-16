import { atomicWrite, command, isEntrypoint, mergeSettings, readLocalSettings, serializeSettings, SETTINGS_PATH } from "./lib.mjs";

export async function setup() {
  const settings = mergeSettings(await readLocalSettings());
  await atomicWrite(SETTINGS_PATH, serializeSettings(settings));
  console.log("Configuração criada em .dev.vars. O segredo existente foi preservado quando já estava configurado.");
}

if (isEntrypoint(import.meta.url)) await command(setup);
