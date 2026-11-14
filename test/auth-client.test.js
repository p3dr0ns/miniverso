import test from "node:test";
import assert from "node:assert/strict";
import { getCurrentSession, onAuthStateChange, sendEmailOtp, signOut, verifyEmailOtp } from "../src/auth.js";

const originalFetch = globalThis.fetch;
const session = (id) => ({ user: { id, email: `${id}@example.com` }, expires_at: Math.floor(Date.now() / 1000) + 3600 });

test.beforeEach(async () => {
  globalThis.fetch = async () => Response.json({ session: null });
  await getCurrentSession();
});
test.afterEach(async () => {
  globalThis.fetch = async () => Response.json({ session: null });
  await getCurrentSession();
  globalThis.fetch = originalFetch;
});

test("the client sends code requests and uses same-origin cookies without bearer tokens", async (t) => {
  const calls = [];
  const changes = [];
  const unsubscribe = onAuthStateChange((value) => changes.push(value));
  t.after(unsubscribe);
  const account = session("collector");
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith("request-code")) return Response.json({ ok: true, resendAfter: 60 }, { status: 202 });
    if (url.endsWith("verify-code")) return Response.json({ session: account });
    return Response.json({ ok: true });
  };
  assert.equal((await sendEmailOtp("collector@example.com")).resendAfter, 60);
  assert.deepEqual(await verifyEmailOtp("collector@example.com", "12345678"), account);
  await signOut();
  assert.deepEqual(changes, [account, null]);
  assert.deepEqual(JSON.parse(calls[1].options.body), { email: "collector@example.com", code: "12345678" });
  for (const { url, options } of calls) {
    assert.match(url, /^\/api\/auth\//);
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.cache, "no-store");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, undefined);
  }
});

test("rate-limit errors preserve the server's retry time", async () => {
  globalThis.fetch = async () => Response.json({ code: "rate_limited", message: "Aguarde.", retryAfter: 125 }, {
    status: 429, headers: { "Retry-After": "125" }
  });
  await assert.rejects(sendEmailOtp("collector@example.com"), (error) => error.code === "rate_limited" && error.retryAfter === 125);
});

test("an old session response cannot undo a newly completed login", async () => {
  let resolveOld;
  globalThis.fetch = async (url) => url.endsWith("session")
    ? new Promise((resolve) => { resolveOld = resolve; })
    : Response.json({ session: session("new-account") });
  const oldRequest = getCurrentSession();
  const loggedIn = await verifyEmailOtp("new-account@example.com", "12345678");
  resolveOld(Response.json({ session: null }));
  assert.deepEqual(await oldRequest, loggedIn);
});

test("only the latest started session query can update the current account", async (t) => {
  const pending = [];
  const changes = [];
  const unsubscribe = onAuthStateChange((value) => changes.push(value));
  t.after(unsubscribe);
  globalThis.fetch = async () => new Promise((resolve) => pending.push(resolve));
  const first = getCurrentSession();
  const second = getCurrentSession();
  pending[0](Response.json({ session: session("old-account") }));
  assert.equal(await first, null);
  const latest = session("latest-account");
  pending[1](Response.json({ session: latest }));
  assert.deepEqual(await second, latest);
  assert.deepEqual(changes, [latest]);
});

test("unavailable, malformed and offline responses give a useful error", async () => {
  globalThis.fetch = async () => new Response("<html>Not found</html>", { status: 404, headers: { "Content-Type": "text/html" } });
  await assert.rejects(getCurrentSession(), /serviço de acesso ainda não está disponível/i);
  globalThis.fetch = async () => new Response("{", { headers: { "Content-Type": "application/json" } });
  await assert.rejects(getCurrentSession(), /resposta incompleta/i);
  globalThis.fetch = async () => { throw new Error("private transport detail"); };
  await assert.rejects(getCurrentSession(), /Confira sua conexão/);
});
