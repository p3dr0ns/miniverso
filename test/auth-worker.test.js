import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { handleRequest } from "../server/worker.js";
const ORIGIN = "https://miniverso.example", EMAIL = "collector@example.com", PASSWORD = "password123";
const migrations = await Promise.all(["0001_auth.sql", "0002_password_auth.sql", "0003_catalog.sql", "0004_reference_catalog.sql", "0005_user_state.sql"].map((name) => readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8")));
async function fixture(t) {
  const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default { fetch() { return new Response('ok'); } };", compatibilityDate: "2026-11-14", d1Databases: { AUTH_DB: randomUUID() } }));
  t.after(() => runtime.dispose()); const db = await runtime.getD1Database("AUTH_DB");
  for (const sql of migrations) await db.batch(sql.split(";").map((part) => part.trim()).filter(Boolean).map((part) => db.prepare(part)));
  const env = { AUTH_DB: db, AUTH_SECRET: "a-test-secret-that-is-at-least-thirty-two-characters", ASSETS: { fetch: async () => new Response("asset") } };
  const request = (path, { method = "POST", body, headers = {}, origin = ORIGIN } = {}) => { const all = { "CF-Connecting-IP": "203.0.113.1", ...headers }; if (method !== "GET") { if (origin !== null) all.Origin = origin; all["Content-Type"] ||= "application/json"; } return handleRequest(new Request(`${ORIGIN}${path}`, { method, headers: all, body: body === undefined ? undefined : JSON.stringify(body) }), env); };
  return { db, env, request };
}
async function error(response, status, code) { assert.equal(response.status, status); assert.equal((await response.json()).code, code); }
test("registration hashes the password and creates a secure session", async (t) => {
  const f = await fixture(t), response = await f.request("/api/auth/register", { body: { email: " COLLECTOR@EXAMPLE.COM ", password: PASSWORD } });
  assert.equal(response.status, 200); const cookie = response.headers.get("set-cookie"); assert.match(cookie, /HttpOnly/i); assert.match(cookie, /Secure/i); assert.match(cookie, /SameSite=Lax/i);
  const user = await f.db.prepare("SELECT * FROM auth_users").first(); assert.equal(user.email, EMAIL); assert.notEqual(user.password_hash, PASSWORD); assert.ok(user.password_salt);
  const current = await f.request("/api/auth/session", { method: "GET", headers: { Cookie: cookie.split(";")[0] } }); assert.equal((await current.json()).session.user.email, EMAIL);
});
test("login validates credentials and rate limits failures", async (t) => {
  const f = await fixture(t); await f.request("/api/auth/register", { body: { email: EMAIL, password: PASSWORD } });
  await error(await f.request("/api/auth/login", { body: { email: EMAIL, password: "wrongpass" } }), 401, "invalid_credentials"); assert.equal((await f.request("/api/auth/login", { body: { email: EMAIL, password: PASSWORD } })).status, 200);
  for (let i = 0; i < 8; i++) await error(await f.request("/api/auth/login", { body: { email: "absent@example.com", password: "wrongpass" } }), 401, "invalid_credentials"); await error(await f.request("/api/auth/login", { body: { email: "absent@example.com", password: "wrongpass" } }), 429, "rate_limited");
});
test("authenticated user can update email and password", async (t) => {
  const f = await fixture(t), registered = await f.request("/api/auth/register", { body: { email: EMAIL, password: PASSWORD } }), cookie = registered.headers.get("set-cookie").split(";")[0];
  const changed = await f.request("/api/auth/account", { headers: { Cookie: cookie }, body: { email: "new@example.com", password: "newpassword123" } });
  assert.equal(changed.status, 200); assert.equal((await changed.json()).user.email, "new@example.com");
  assert.equal((await f.request("/api/auth/login", { body: { email: "new@example.com", password: "newpassword123" } })).status, 200);
  await error(await f.request("/api/auth/login", { body: { email: EMAIL, password: PASSWORD } }), 401, "invalid_credentials");
  await error(await f.request("/api/auth/account", { body: { email: "other@example.com" } }), 401, "authentication_required");
});
test("collection state synchronizes per authenticated user", async (t) => {
  const f = await fixture(t), registered = await f.request("/api/auth/register", { body: { email: EMAIL, password: PASSWORD } }), cookie = registered.headers.get("set-cookie").split(";")[0];
  const state = { minis: [{ id: "mini-1", name: "Porsche 911" }], showcases: [], placements: {}, drafts: {}, activeShowcaseId: null };
  const saved = await f.request("/api/state", { method: "PUT", headers: { Cookie: cookie }, body: { state } }); assert.equal(saved.status, 200);
  const loaded = await f.request("/api/state", { method: "GET", headers: { Cookie: cookie } }); assert.deepEqual((await loaded.json()).state, state);
  await error(await f.request("/api/state", { method: "GET" }), 401, "authentication_required");
});
test("server rejects invalid requests and missing configuration", async (t) => {
  const f = await fixture(t); await error(await f.request("/api/auth/register", { body: { email: EMAIL, password: PASSWORD }, origin: null }), 403, "origin_not_allowed"); await error(await f.request("/api/auth/register", { body: { email: "bad", password: PASSWORD } }), 400, "invalid_request"); await error(await f.request("/api/auth/register", { body: { email: EMAIL, password: "short" } }), 400, "invalid_request"); delete f.env.AUTH_SECRET; await error(await f.request("/api/auth/session", { method: "GET" }), 503, "auth_unavailable");
});
test("authenticated users contribute and find shared catalog items", async (t) => {
  const f = await fixture(t); const registered = await f.request("/api/auth/register", { body: { email: EMAIL, password: PASSWORD } }); const cookie = registered.headers.get("set-cookie").split(";")[0];
  const contribution = await f.request("/api/catalog/contribute", { headers: { Cookie: cookie }, body: { code: "hkg47", name: "Porsche 911", maker: "Hot Wheels", color: "Laranja" } }); assert.equal(contribution.status, 201);
  const found = await f.request("/api/catalog/HKG47", { method: "GET", headers: { Cookie: cookie } }); const body = await found.json(); assert.equal(body.item.name, "Porsche 911"); assert.equal(body.item.code, "HKG47");
  await error(await f.request("/api/catalog/HKG47", { method: "GET" }), 401, "authentication_required");
});
test("catalog rejects a stand code label saved as a miniature name", async (t) => {
  const f = await fixture(t); const registered = await f.request("/api/auth/register", { body: { email: EMAIL, password: PASSWORD } }); const cookie = registered.headers.get("set-cookie").split(";")[0];
  const now = Math.floor(Date.now() / 1000), user = await f.db.prepare("SELECT id FROM auth_users WHERE email=?").bind(EMAIL).first(); await f.db.prepare("INSERT INTO catalog_items(code,data_json,contributor_id,created_at,updated_at) VALUES(?,?,?,?,?)").bind("U43A", JSON.stringify({ name: "Stand code(s): U43A", maker: "Hot Wheels" }), user.id, now, now).run();
  const found = await f.request("/api/catalog/U43A", { method: "GET", headers: { Cookie: cookie } }); assert.equal((await found.json()).item, null);
});
test("catalog uses the curated reference data and registered image", async (t) => {
  const f = await fixture(t); const registered = await f.request("/api/auth/register", { body: { email: EMAIL, password: PASSWORD } }); const cookie = registered.headers.get("set-cookie").split(";")[0];
  const data = { name: "Carro da base", maker: "Hot Wheels", scale: "1:64", color: "Azul", releaseYear: "2025", category: "Mainline", series: "Série A" }, image = "https://static.wikia.nocookie.net/example/car.jpg";
  await f.db.prepare("INSERT INTO catalog_reference(code,data_json,variants_json,images_json,source_name,updated_at) VALUES(?,?,?,?,?,?)").bind("ABC12", JSON.stringify(data), JSON.stringify([data]), JSON.stringify([image]), "Base Miniverso 2015–2026", 1).run();
  const found = await f.request("/api/catalog/ABC12", { method: "GET", headers: { Cookie: cookie } }); const item = (await found.json()).item;
  assert.equal(item.name, data.name); assert.equal(item.color, "Azul"); assert.equal(item.photo, image); assert.deepEqual(item.images, [image]);
  const listing = await f.request("/api/catalog?query=Carro", { method: "GET", headers: { Cookie: cookie } }), listed = (await listing.json()).items;
  assert.equal(listing.status, 200); assert.equal(listed.length, 1); assert.equal(listed[0].code, "ABC12"); assert.equal(listed[0].photo, image);
});
