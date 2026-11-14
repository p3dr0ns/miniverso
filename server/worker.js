const CODE_TTL = 10 * 60;
const SESSION_TTL = 7 * 24 * 60 * 60;
const RESEND_AFTER = 60;
const RATE_WINDOW = 60 * 60;
const EMAIL_SEND_LIMIT = 5;
const IP_SEND_LIMIT = 20;
const PROJECT_SEND_LIMIT = 100;
const MAX_ATTEMPTS = 5;
const MAX_BODY_BYTES = 2048;
const COOKIE_NAME = "miniverso_session";
const encoder = new TextEncoder();

class AuthError extends Error {
  constructor(status, code, message, retryAfter) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders
    }
  });
}

function unavailable() {
  return new AuthError(503, "auth_unavailable", "O acesso está temporariamente indisponível. Tente novamente mais tarde.");
}

function invalidRequest(message = "Confira os dados enviados e tente novamente.", status = 400) {
  return new AuthError(status, "invalid_request", message);
}

function invalidCode() {
  return new AuthError(400, "invalid_code", "Código inválido, expirado ou já utilizado. Solicite um novo código se necessário.");
}

function normalizedEmail(value) {
  if (typeof value !== "string") throw invalidRequest("Informe um e-mail válido.");
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw invalidRequest("Informe um e-mail válido.");
  }
  return email;
}

function configuration(env) {
  if (!env.AUTH_DB?.prepare || !env.AUTH_DB?.batch
    || typeof env.AUTH_SECRET !== "string" || env.AUTH_SECRET.trim().length < 32
    || typeof env.BREVO_API_KEY !== "string" || !env.BREVO_API_KEY.trim()
    || typeof env.MAIL_FROM_EMAIL !== "string"
    || typeof env.MAIL_FROM_NAME !== "string" || !env.MAIL_FROM_NAME.trim()) {
    throw unavailable();
  }
  try {
    normalizedEmail(env.MAIL_FROM_EMAIL);
  } catch {
    throw unavailable();
  }
}

async function readJson(request) {
  const contentType = request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw invalidRequest("Envie os dados no formato JSON.", 415);
  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength && Number(declaredLength) > MAX_BODY_BYTES) {
    throw invalidRequest("A solicitação é grande demais.", 413);
  }
  if (!request.body) throw invalidRequest();
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        throw invalidRequest("A solicitação é grande demais.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw invalidRequest();
    return body;
  } catch {
    throw invalidRequest("Não foi possível ler os dados enviados.");
  }
}

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(text)));
}

async function tokenHash(token) {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(token)));
}

function randomCode() {
  // Rejection sampling avoids bias when mapping a 32-bit random value to 8 digits.
  const values = new Uint32Array(1);
  do {
    crypto.getRandomValues(values);
  } while (values[0] >= 4_200_000_000);
  return String(values[0] % 100_000_000).padStart(8, "0");
}

function randomSessionToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function sessionCookie(token, now) {
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL}; Expires=${new Date((now + SESSION_TTL) * 1000).toUTCString()}`;
}

function clearCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

function requestSessionToken(request) {
  const value = request.headers.get("Cookie")?.match(/(?:^|;\s*)miniverso_session=([^;]*)/)?.[1];
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

function publicSession(row) {
  return row ? { user: { id: row.user_id, email: row.email }, expires_at: row.expires_at } : null;
}

function cleanupStatements(db, now) {
  return [
    db.prepare("DELETE FROM auth_send_requests WHERE created_at <= ?").bind(now - RATE_WINDOW),
    db.prepare("DELETE FROM auth_challenges WHERE expires_at <= ?").bind(now),
    db.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").bind(now)
  ];
}

async function rateLimitError(db, email, ipHash, now) {
  const row = await db.prepare(`
    SELECT MAX(CASE WHEN email = ?1 THEN created_at END) AS email_last,
      SUM(CASE WHEN email = ?1 THEN 1 ELSE 0 END) AS email_count,
      MIN(CASE WHEN email = ?1 THEN created_at END) AS email_first,
      SUM(CASE WHEN ip_hash = ?2 THEN 1 ELSE 0 END) AS ip_count,
      MIN(CASE WHEN ip_hash = ?2 THEN created_at END) AS ip_first,
      COUNT(*) AS project_count, MIN(created_at) AS project_first
    FROM auth_send_requests WHERE created_at > ?3
  `).bind(email, ipHash, now - RATE_WINDOW).first();
  let retryAfter = 1;
  if (row?.email_last != null) retryAfter = Math.max(retryAfter, row.email_last + RESEND_AFTER - now);
  if (row?.email_count >= EMAIL_SEND_LIMIT) retryAfter = Math.max(retryAfter, row.email_first + RATE_WINDOW - now);
  if (row?.ip_count >= IP_SEND_LIMIT) retryAfter = Math.max(retryAfter, row.ip_first + RATE_WINDOW - now);
  if (row?.project_count >= PROJECT_SEND_LIMIT) retryAfter = Math.max(retryAfter, row.project_first + RATE_WINDOW - now);
  return new AuthError(429, "rate_limited", "Aguarde antes de solicitar outro código. O limite de envios foi atingido.", Math.ceil(retryAfter));
}

async function deliverCode(env, email, code) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      redirect: "error",
      headers: { "api-key": env.BREVO_API_KEY, "Content-Type": "application/json", Accept: "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        sender: { name: env.MAIL_FROM_NAME.trim(), email: env.MAIL_FROM_EMAIL.trim() },
        to: [{ email }],
        subject: "Seu código do Miniverso",
        textContent: `Seu código de acesso ao Miniverso é: ${code}\n\nDigite o código no site em até 10 minutos. Ele só pode ser usado uma vez. Se você não solicitou este acesso, ignore este e-mail.`
      })
    });
    const accepted = response.ok;
    if (response.body) await response.body.cancel().catch(() => {});
    if (!accepted) throw new Error("Email delivery unavailable");
  } finally {
    clearTimeout(timer);
  }
}

async function requestCode(request, env) {
  const email = normalizedEmail((await readJson(request)).email);
  const db = env.AUTH_DB;
  const challengeId = crypto.randomUUID();
  const code = randomCode();
  const codeHash = await hmac(env.AUTH_SECRET, `otp\0${challengeId}\0${email}\0${code}`);
  const ipHash = await hmac(env.AUTH_SECRET, `ip\0${request.headers.get("CF-Connecting-IP") || "unknown"}`);
  const now = Math.floor(Date.now() / 1000);
  // The conditional admission and challenge replacement run in one D1 transaction.
  // Failed deliveries retain their admission record to prevent retry-driven floods.
  const results = await db.batch([
    db.prepare(`
      INSERT INTO auth_send_requests (id, email, ip_hash, created_at)
      SELECT ?1, ?2, ?3, ?4
      WHERE NOT EXISTS (SELECT 1 FROM auth_send_requests WHERE email = ?2 AND created_at > ?5)
        AND (SELECT COUNT(*) FROM auth_send_requests WHERE email = ?2 AND created_at > ?6) < ?7
        AND (SELECT COUNT(*) FROM auth_send_requests WHERE ip_hash = ?3 AND created_at > ?6) < ?8
        AND (SELECT COUNT(*) FROM auth_send_requests WHERE created_at > ?6) < ?9
    `).bind(challengeId, email, ipHash, now, now - RESEND_AFTER, now - RATE_WINDOW, EMAIL_SEND_LIMIT, IP_SEND_LIMIT, PROJECT_SEND_LIMIT),
    db.prepare(`
      INSERT INTO auth_challenges (email, id, code_hash, created_at, expires_at, attempts, status, consumed_by)
      SELECT ?1, ?2, ?3, ?4, ?5, 0, 'pending', NULL
      WHERE EXISTS (SELECT 1 FROM auth_send_requests WHERE id = ?2)
      ON CONFLICT(email) DO UPDATE SET id = excluded.id, code_hash = excluded.code_hash,
        created_at = excluded.created_at, expires_at = excluded.expires_at,
        attempts = 0, status = 'pending', consumed_by = NULL
    `).bind(email, challengeId, codeHash, now, now + CODE_TTL),
    ...cleanupStatements(db, now)
  ]);
  if (results[0].meta.changes !== 1) throw await rateLimitError(db, email, ipHash, now);
  try {
    await deliverCode(env, email, code);
    const activated = await db.prepare("UPDATE auth_challenges SET status = 'active' WHERE id = ? AND status = 'pending' AND expires_at > unixepoch('now')")
      .bind(challengeId).run();
    if (activated.meta.changes !== 1) throw new Error("Challenge no longer current");
  } catch {
    await db.prepare("DELETE FROM auth_challenges WHERE id = ?").bind(challengeId).run();
    throw new AuthError(502, "email_delivery_failed", "Não foi possível enviar o código agora. Aguarde e tente novamente.", RESEND_AFTER);
  }
  return json({ ok: true, resendAfter: RESEND_AFTER }, 202);
}

async function verifyCode(request, env) {
  const body = await readJson(request);
  const email = normalizedEmail(body.email);
  if (typeof body.code !== "string" || !/^[0-9]{8}$/.test(body.code)) {
    throw invalidRequest("Digite os 8 dígitos do código recebido por e-mail.");
  }
  const db = env.AUTH_DB;
  const challenge = await db.prepare("SELECT id FROM auth_challenges WHERE email = ? AND status = 'active' AND expires_at > unixepoch('now') AND attempts < ?")
    .bind(email, MAX_ATTEMPTS).first();
  if (!challenge) throw invalidCode();
  const expectedHash = await hmac(env.AUTH_SECRET, `otp\0${challenge.id}\0${email}\0${body.code}`);
  const verificationId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const sessionToken = randomSessionToken();
  const sessionTokenHash = await tokenHash(sessionToken);
  const now = Math.floor(Date.now() / 1000);
  // The update serializes attempts and consumes the challenge exactly once.
  // A per-verification nonce gates all subsequent writes in the same transaction.
  const results = await db.batch([
    db.prepare(`
      UPDATE auth_challenges SET attempts = attempts + 1,
        status = CASE WHEN code_hash = ?1 THEN 'consumed' ELSE status END,
        consumed_by = CASE WHEN code_hash = ?1 THEN ?2 ELSE NULL END
      WHERE id = ?3 AND email = ?4 AND status = 'active' AND expires_at > unixepoch('now') AND attempts < ?5
    `).bind(expectedHash, verificationId, challenge.id, email, MAX_ATTEMPTS),
    db.prepare(`
      INSERT INTO auth_users (id, email, created_at)
      SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM auth_challenges WHERE id = ?4 AND consumed_by = ?5)
      ON CONFLICT(email) DO NOTHING
    `).bind(userId, email, now, challenge.id, verificationId),
    db.prepare(`
      INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at)
      SELECT ?1, u.id, ?2, ?3 FROM auth_users u
      WHERE u.email = ?4 AND EXISTS (SELECT 1 FROM auth_challenges WHERE id = ?5 AND consumed_by = ?6)
    `).bind(sessionTokenHash, now, now + SESSION_TTL, email, challenge.id, verificationId),
    db.prepare(`
      SELECT s.user_id, u.email, s.expires_at FROM auth_sessions s
      JOIN auth_users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > unixepoch('now')
    `).bind(sessionTokenHash),
    ...cleanupStatements(db, now)
  ]);
  const session = publicSession(results[3].results[0]);
  if (!session) throw invalidCode();
  return json({ session }, 200, { "Set-Cookie": sessionCookie(sessionToken, now) });
}

async function currentSession(request, env) {
  const token = requestSessionToken(request);
  if (!token) return json({ session: null });
  const row = await env.AUTH_DB.prepare(`
    SELECT s.user_id, u.email, s.expires_at FROM auth_sessions s
    JOIN auth_users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > unixepoch('now')
  `).bind(await tokenHash(token)).first();
  return json({ session: publicSession(row) });
}

async function logout(request, env) {
  await readJson(request);
  const token = requestSessionToken(request);
  if (token) await env.AUTH_DB.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").bind(await tokenHash(token)).run();
  return json({ ok: true }, 200, { "Set-Cookie": clearCookie() });
}

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== "/api" && !url.pathname.startsWith("/api/")) {
    return env.ASSETS?.fetch ? env.ASSETS.fetch(request) : new Response("Não encontrado.", { status: 404 });
  }
  try {
    const routes = {
      "/api/auth/request-code": "POST",
      "/api/auth/verify-code": "POST",
      "/api/auth/session": "GET",
      "/api/auth/logout": "POST"
    };
    const method = routes[url.pathname];
    if (!method) throw new AuthError(404, "not_found", "Endereço não encontrado.");
    if (request.method !== method) {
      return json({ code: "method_not_allowed", message: "Método não permitido." }, 405, { Allow: method });
    }
    if (request.method === "POST" && request.headers.get("Origin") !== url.origin) {
      throw new AuthError(403, "origin_not_allowed", "Esta solicitação não é permitida.");
    }
    configuration(env);
    if (url.pathname === "/api/auth/request-code") return await requestCode(request, env);
    if (url.pathname === "/api/auth/verify-code") return await verifyCode(request, env);
    if (url.pathname === "/api/auth/session") return await currentSession(request, env);
    return await logout(request, env);
  } catch (error) {
    const failure = error instanceof AuthError ? error : unavailable();
    const body = { code: failure.code, message: failure.message };
    const headers = {};
    if (failure.retryAfter != null) {
      body.retryAfter = failure.retryAfter;
      headers["Retry-After"] = String(failure.retryAfter);
    }
    return json(body, failure.status, headers);
  }
}

export default { fetch: handleRequest };
