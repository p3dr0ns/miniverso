import { atomicWrite, command, isEntrypoint, mergeSettings, promptSecret, promptText, readLocalSettings, serializeSettings, SETTINGS_PATH, validateSettings } from "./lib.mjs";

async function checkSender(settings) {
  let response;
  try {
    response = await fetch("https://api.brevo.com/v3/senders", {
      headers: { "api-key": settings.BREVO_API_KEY, Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
      redirect: "error"
    });
  } catch {
    throw new Error("Não foi possível consultar o Brevo. Confira a conexão ou repita o setup sem --check.");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("O Brevo não confirmou o acesso. Confira a chave de API e o estado da sua conta.");
  }
  const result = await response.json();
  const sender = result.senders?.find((item) => item.email?.toLowerCase() === settings.MAIL_FROM_EMAIL.toLowerCase());
  if (!sender?.active) throw new Error("Esse remetente ainda não está ativo no Brevo. Confirme o endereço no painel e repita o setup.");
}

export async function setup({ edit = false, check = false } = {}) {
  const saved = await readLocalSettings();
  const settings = mergeSettings(saved);
  console.log("Configuração do login por código do Miniverso.");
  console.log("A chave de envio fica somente no servidor; a entrada da chave não aparece na tela.");
  if (edit || !settings.BREVO_API_KEY) settings.BREVO_API_KEY = await promptSecret("Chave de API do Brevo", settings.BREVO_API_KEY);
  if (edit || !settings.MAIL_FROM_EMAIL) settings.MAIL_FROM_EMAIL = await promptText("E-mail do remetente confirmado no Brevo", settings.MAIL_FROM_EMAIL);
  if (edit) settings.MAIL_FROM_NAME = await promptText("Nome do remetente", settings.MAIL_FROM_NAME);
  validateSettings(settings);
  if (check) {
    console.log("Conferindo o remetente no Brevo, sem enviar e-mail...");
    await checkSender(settings);
  }
  await atomicWrite(SETTINGS_PATH, serializeSettings(settings));
  console.log("\nConfiguração salva em .dev.vars, fora do Git. O segredo de autenticação foi preservado ou gerado automaticamente.");
  console.log("Para testar no computador: npm run dev");
  console.log("Para conectar a hospedagem: npm exec wrangler login");
  console.log("Para publicar: npm run deploy");
}

if (isEntrypoint(import.meta.url)) {
  await command(async () => {
    const args = process.argv.slice(2);
    if (args.some((argument) => !["--edit", "--check"].includes(argument))) throw new Error("Opções disponíveis: --edit e --check.");
    await setup({ edit: args.includes("--edit"), check: args.includes("--check") });
  });
}
