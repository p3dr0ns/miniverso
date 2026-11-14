import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { handleRequest } from "../server/worker.js";

const ORIGIN = "https://miniverso.example";
const EMAIL = "collector@example.com";
const migration = await readFile(new URL("../migrations/0001_auth.sql", import.meta.url), "utf8");

async function fixture(t, { mailStatus = 201 } = {}) {
  const originalFetch = globalThis.fetch;
  const runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: "export default { fetch() { return new Response('test runtime'); } };",
    compatibilityDate: "2026-11-14",
    d1Databases: { AUTH_DB: randomUUID() },
  }));
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await runtime.dispose();
  });
  const db = await runtime.getD1Database("AUTH_DB");
  await db.batch(migration.split(";").map((sql) => sql.trim()).filter(Boolean).map((sql) => db.prepare(sql)));
  const env = {
    AUTH_DB: db,
    AUTH_SECRET: "a-test-secret-that-is-at-least-thirty-two-characters",
    BREVO_API_KEY: "not-a-real-provider-key",
    MAIL_FROM_EMAIL: "sender@example.com",
    MAIL_FROM_NAME: "Miniverso",
    ASSETS: { fetch: async () => new Response("static asset") },
  };
  const deliveries = [];
  globalThis.fetch = async (input, init) => {
    const outgoingUrl = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    if (outgoingUrl !== "https://api.brevo.com/v3/smtp/email") {
      return originalFetch(input, init);
    }
    const outgoing = new Request(input, init);
    assert.equal(outgoing.method, "POST");
    assert.equal(outgoing.headers.get("api-key"), env.BREVO_API_KEY);
    const payload = await outgoing.json();
    deliveries.push(payload);
    return Response.json(
      mailStatus < 400 ? { messageId: "mock-delivery" } : { message: "Provider private diagnostic" },
      { status: mailStatus },
    );
  };

  function request(path, { method = "POST", body, headers = {}, origin = ORIGIN } = {}) {
    const requestHeaders = { "CF-Connecting-IP": "203.0.113.1", ...headers };
    if (method !== "GET" && method !== "HEAD") {
      if (origin !== null) requestHeaders.Origin = origin;
      if (!requestHeaders["Content-Type"]) requestHeaders["Content-Type"] = "application/json";
    }
    return handleRequest(new Request(`${ORIGIN}${path}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
    }), env);
  }

  function code(delivery = deliveries.at(-1)) {
    assert.ok(delivery, "An email should have been submitted to the mock transport");
    const message = `${delivery.textContent || ""} ${delivery.htmlContent || ""}`;
    const match = message.match(/\b\d{8}\b/);
    assert.ok(match, "The email should contain an eight-digit code");
    return match[0];
  }

  const send = (email = EMAIL, options = {}) => request("/api/auth/request-code", {
    body: { email }, ...options,
  });
  const verify = (token, email = EMAIL) => request("/api/auth/verify-code", {
    body: { email, code: token },
  });
  return { db, env, deliveries, request, code, send, verify };
}

async function expectError(response, status, code) {
  assert.equal(response.status, status);
  const body = await response.json();
  assert.equal(body.code, code);
  assert.equal(typeof body.message, "string");
  assert.ok(body.message.length > 0);
  assert.match(response.headers.get("cache-control"), /no-store/);
  return body;
}

test("email code creates a stable account, keeps the session in a secure cookie and supports logout", async (t) => {
  const f = await fixture(t);
  const sent = await f.send("  COLLECTOR@EXAMPLE.COM  ");
  assert.equal(sent.status, 202);
  assert.match(sent.headers.get("cache-control"), /no-store/);
  assert.deepEqual(await sent.json(), { ok: true, resendAfter: 60 });
  assert.equal(f.deliveries.length, 1);
  assert.equal(f.deliveries[0].to[0].email, EMAIL);

  const token = f.code();
  const storedChallenge = await f.db.prepare("SELECT code_hash FROM auth_challenges WHERE email = ?").bind(EMAIL).first();
  assert.ok(storedChallenge);
  assert.notEqual(storedChallenge.code_hash, token, "The database must not contain a plaintext OTP");
  assert.notEqual(storedChallenge.code_hash.length, token.length);

  const verified = await f.verify(token);
  assert.equal(verified.status, 200);
  const cookie = verified.headers.get("set-cookie");
  assert.match(cookie, /^miniverso_session=/);
  assert.match(cookie, /;\s*HttpOnly/i);
  assert.match(cookie, /;\s*Secure/i);
  assert.match(cookie, /;\s*SameSite=Lax/i);
  assert.match(cookie, /;\s*Path=\//i);
  const cookiePair = cookie.split(";")[0];
  const cookieToken = cookiePair.slice(cookiePair.indexOf("=") + 1);
  const body = await verified.json();
  assert.equal(body.session.user.email, EMAIL);
  assert.match(body.session.user.id, /^[0-9a-f-]{36}$/i);
  assert.ok(body.session.expires_at > Math.floor(Date.now() / 1000));
  assert.ok(!JSON.stringify(body).includes(cookieToken), "The session secret must not be exposed as JSON");
  assert.ok(!JSON.stringify(body).includes(token), "The OTP must not be echoed back to the browser");
  const userId = body.session.user.id;

  const session = await f.request("/api/auth/session", { method: "GET", headers: { Cookie: cookiePair } });
  assert.equal(session.status, 200);
  assert.equal((await session.json()).session.user.id, userId);
  const anonymous = await f.request("/api/auth/session", { method: "GET" });
  assert.deepEqual(await anonymous.json(), { session: null });

  const logout = await f.request("/api/auth/logout", { body: {}, headers: { Cookie: cookiePair } });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/i);
  const afterLogout = await f.request("/api/auth/session", { method: "GET", headers: { Cookie: cookiePair } });
  assert.deepEqual(await afterLogout.json(), { session: null });

  await f.db.exec("DELETE FROM auth_send_requests; DELETE FROM auth_challenges;");
  assert.equal((await f.send()).status, 202);
  const secondLogin = await f.verify(f.code());
  assert.equal(secondLogin.status, 200);
  assert.equal((await secondLogin.json()).session.user.id, userId, "A new login must keep the same account ID");
});

test("a consumed code cannot be reused, including two simultaneous verification requests", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.send()).status, 202);
  const token = f.code();
  const responses = await Promise.all([f.verify(token), f.verify(token)]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 400]);
  await expectError(await f.verify(token), 400, "invalid_code");
  const sessions = await f.db.prepare("SELECT COUNT(*) AS total FROM auth_sessions").first();
  assert.equal(sessions.total, 1, "Concurrent verification must create just one session");
});

test("five incorrect attempts invalidate a code and do not create an account", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.send()).status, 202);
  const token = f.code();
  const incorrect = token === "00000000" ? "11111111" : "00000000";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await expectError(await f.verify(incorrect), 400, "invalid_code");
  }
  await expectError(await f.verify(token), 400, "invalid_code");
  const users = await f.db.prepare("SELECT COUNT(*) AS total FROM auth_users").first();
  assert.equal(users.total, 0);
});

test("expired challenges and sessions are rejected", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.send()).status, 202);
  const expiredToken = f.code();
  await f.db.prepare("UPDATE auth_challenges SET expires_at = ? WHERE email = ?")
    .bind(Math.floor(Date.now() / 1000) - 1, EMAIL).run();
  await expectError(await f.verify(expiredToken), 400, "invalid_code");

  await f.db.exec("DELETE FROM auth_send_requests; DELETE FROM auth_challenges;");
  assert.equal((await f.send()).status, 202);
  const verified = await f.verify(f.code());
  assert.equal(verified.status, 200);
  const cookiePair = verified.headers.get("set-cookie").split(";")[0];
  await f.db.prepare("UPDATE auth_sessions SET expires_at = ?").bind(Math.floor(Date.now() / 1000) - 1).run();
  const session = await f.request("/api/auth/session", { method: "GET", headers: { Cookie: cookiePair } });
  assert.deepEqual(await session.json(), { session: null });
});

test("a newer code replaces the old one after the cooldown", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.send()).status, 202);
  const firstToken = f.code();
  await f.db.exec("UPDATE auth_send_requests SET created_at = created_at - 61; UPDATE auth_challenges SET created_at = created_at - 61;");
  assert.equal((await f.send()).status, 202);
  assert.equal(f.deliveries.length, 2);
  const newToken = f.code();
  if (newToken !== firstToken) await expectError(await f.verify(firstToken), 400, "invalid_code");
  assert.equal((await f.verify(newToken)).status, 200);
});

test("email cooldown does not send another email and reports a retry time", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.send()).status, 202);
  const denied = await f.send();
  const retryHeader = Number(denied.headers.get("retry-after"));
  const body = await expectError(denied, 429, "rate_limited");
  assert.ok(retryHeader > 0 && retryHeader <= 60);
  assert.equal(body.retryAfter, retryHeader);
  assert.equal(f.deliveries.length, 1);
  assert.equal((await f.verify(f.code())).status, 200, "A rejected resend must preserve the last valid code");
});

test("concurrent resend requests admit only one email", async (t) => {
  const f = await fixture(t);
  const responses = await Promise.all([f.send(), f.send()]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [202, 429]);
  assert.equal(f.deliveries.length, 1);
  assert.equal((await f.verify(f.code())).status, 200);
});

test("per-email hourly limits still apply when each request is outside the cooldown", async (t) => {
  const f = await fixture(t);
  for (let count = 0; count < 5; count += 1) {
    assert.equal((await f.send()).status, 202);
    await f.db.exec("UPDATE auth_send_requests SET created_at = created_at - 61; UPDATE auth_challenges SET created_at = created_at - 61;");
  }
  await expectError(await f.send(), 429, "rate_limited");
  assert.equal(f.deliveries.length, 5);
});

test("per-IP limits prevent sending to arbitrary new addresses", async (t) => {
  const f = await fixture(t);
  for (let count = 0; count < 20; count += 1) {
    assert.equal((await f.send(`collector-${count}@example.com`)).status, 202);
  }
  await expectError(await f.send("one-more@example.com"), 429, "rate_limited");
  assert.equal(f.deliveries.length, 20);
});

test("the project-wide limit applies across different email addresses and IPs", async (t) => {
  const f = await fixture(t);
  for (let count = 0; count < 100; count += 1) {
    const response = await f.send(`collector-${count}@example.com`, {
      headers: { "CF-Connecting-IP": `203.0.113.${count + 1}` },
    });
    assert.equal(response.status, 202);
  }
  await expectError(await f.send("one-more@example.com", {
    headers: { "CF-Connecting-IP": "198.51.100.1" },
  }), 429, "rate_limited");
  assert.equal(f.deliveries.length, 100);
});

test("missing server configuration fails closed without exposing secrets", async (t) => {
  const f = await fixture(t);
  for (const key of ["AUTH_SECRET", "BREVO_API_KEY", "MAIL_FROM_EMAIL", "MAIL_FROM_NAME"]) {
    const original = f.env[key];
    delete f.env[key];
    const response = await f.send();
    const body = await expectError(response, 503, "auth_unavailable");
    assert.ok(!JSON.stringify(body).includes("not-a-real-provider-key"));
    f.env[key] = original;
  }
  f.env.AUTH_SECRET = "too-short";
  await expectError(await f.send(), 503, "auth_unavailable");
  assert.equal(f.deliveries.length, 0);
});

test("requests enforce same-origin JSON, valid inputs, size limits and known routes", async (t) => {
  const f = await fixture(t);
  await expectError(await f.send(EMAIL, { origin: "https://another.example" }), 403, "origin_not_allowed");
  await expectError(await f.send(EMAIL, { origin: null }), 403, "origin_not_allowed");
  await expectError(await f.send("not-an-email"), 400, "invalid_request");
  await expectError(await f.request("/api/auth/request-code", { body: "{" }), 400, "invalid_request");
  await expectError(await f.request("/api/auth/request-code", {
    body: { email: EMAIL }, headers: { "Content-Type": "text/plain" },
  }), 415, "invalid_request");
  await expectError(await f.send(`${"a".repeat(2100)}@example.com`), 413, "invalid_request");
  await expectError(await f.verify("123"), 400, "invalid_request");
  await expectError(await f.request("/api/auth/request-code", { method: "GET" }), 405, "method_not_allowed");
  await expectError(await f.request("/api/unknown", { method: "GET" }), 404, "not_found");
  await expectError(await f.request("/api/auth/logout", {
    body: {}, headers: { "Content-Type": "text/plain" },
  }), 415, "invalid_request");
  await expectError(await f.request("/api/auth/logout", {
    body: { padding: "a".repeat(2100) },
  }), 413, "invalid_request");
  const asset = await f.request("/", { method: "GET" });
  assert.equal(await asset.text(), "static asset");
  assert.equal(f.deliveries.length, 0);
});

test("a code that expires while the request body is being read cannot establish a session", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.send()).status, 202);
  const code = f.code();
  await f.db.prepare("UPDATE auth_challenges SET expires_at = ? WHERE email = ?")
    .bind(Math.floor(Date.now() / 1000) + 1, EMAIL).run();
  const body = new ReadableStream({
    async start(controller) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      controller.enqueue(new TextEncoder().encode(JSON.stringify({ email: EMAIL, code })));
      controller.close();
    }
  });
  const response = await handleRequest(new Request(`${ORIGIN}/api/auth/verify-code`, {
    method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body, duplex: "half"
  }), f.env);
  await expectError(response, 400, "invalid_code");
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS total FROM auth_sessions").first()).total, 0);
});

test("a failed email delivery never leaves an active code or discloses provider diagnostics", async (t) => {
  const f = await fixture(t, { mailStatus: 500 });
  const response = await f.send();
  const body = await expectError(response, 502, "email_delivery_failed");
  assert.ok(!JSON.stringify(body).includes("Provider private diagnostic"));
  assert.equal(f.deliveries.length, 1);
  await expectError(await f.verify(f.code()), 400, "invalid_code");
  const users = await f.db.prepare("SELECT COUNT(*) AS total FROM auth_users").first();
  assert.equal(users.total, 0);
});
