import test from "node:test";
import assert from "node:assert/strict";
import { createAccount, getCurrentSession, signIn, signOut } from "../src/auth.js";
const originalFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = originalFetch; });
test("client uses password endpoints and same-origin cookies", async () => {
  const account = { user: { id: "user", email: "collector@example.com" }, expires_at: 9999999999 }, calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return url.endsWith("logout") ? Response.json({ ok: true }) : Response.json({ session: account }); };
  assert.deepEqual(await createAccount("collector@example.com", "password123"), account);
  assert.deepEqual(await signIn("collector@example.com", "password123"), account);
  await signOut();
  assert.deepEqual(JSON.parse(calls[0].options.body), { email: "collector@example.com", password: "password123" });
  for (const call of calls) assert.equal(call.options.credentials, "same-origin");
});
test("client preserves structured errors", async () => {
  globalThis.fetch = async () => Response.json({ code: "rate_limited", message: "Aguarde.", retryAfter: 125 }, { status: 429 });
  await assert.rejects(signIn("collector@example.com", "password123"), (error) => error.code === "rate_limited" && error.retryAfter === 125);
  globalThis.fetch = async () => new Response("not json", { status: 404, headers: { "Content-Type": "text/plain" } });
  await assert.rejects(getCurrentSession(), /serviço de acesso/i);
});
