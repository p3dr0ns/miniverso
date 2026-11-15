const listeners = new Set();
let currentSession = null;
let expiryTimer;
let sessionRevision = 0;
let sessionQuery = 0;
let channel = null;
try {
  if (typeof window !== "undefined" && typeof BroadcastChannel === "function") channel = new BroadcastChannel("miniverso-auth");
} catch {
  // A sincronização entre abas é opcional quando o navegador a restringe.
}

async function authRequest(path, { method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(`/api/auth/${path}`, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: body ? { "Content-Type": "application/json", Accept: "application/json" } : { Accept: "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
  } catch {
    throw new Error("Não foi possível conectar ao serviço de acesso. Confira sua conexão e tente novamente.");
  }
  if (!response.headers.get("Content-Type")?.includes("application/json")) {
    throw new Error("O serviço de acesso ainda não está disponível neste endereço.");
  }
  let data;
  try {
    data = await response.json();
    if (!data || typeof data !== "object") throw new Error();
  } catch {
    throw new Error("O serviço de acesso retornou uma resposta incompleta. Tente novamente.");
  }
  if (!response.ok) {
    const error = new Error(data.message || "Não foi possível concluir o acesso.");
    error.code = data.code;
    error.retryAfter = Number(data.retryAfter || response.headers.get("Retry-After")) || 0;
    throw error;
  }
  return data;
}

function updateSession(session, broadcast = false) {
  sessionRevision += 1;
  currentSession = session;
  clearTimeout(expiryTimer);
  if (session?.expires_at) {
    const remaining = session.expires_at * 1000 - Date.now();
    expiryTimer = setTimeout(() => updateSession(null), Math.max(0, Math.min(remaining, 2147483647)));
  }
  listeners.forEach((listener) => listener(session));
  if (broadcast) channel?.postMessage("session-changed");
}

async function refreshSession() {
  const revision = sessionRevision;
  const query = ++sessionQuery;
  try {
    const { session } = await authRequest("session");
    if (query === sessionQuery && revision === sessionRevision && (session?.user?.id !== currentSession?.user?.id || session?.expires_at !== currentSession?.expires_at)) {
      updateSession(session);
    }
  } catch {
    // Falhas temporárias de rede não apagam uma sessão ainda válida.
  }
}

export async function getCurrentSession() {
  const revision = sessionRevision;
  const query = ++sessionQuery;
  const { session } = await authRequest("session");
  if (query === sessionQuery && revision === sessionRevision) updateSession(session);
  return currentSession;
}

async function authenticate(path, email, password) {
  const { session } = await authRequest(path, { method: "POST", body: { email, password } });
  updateSession(session, true);
  return session;
}

export const createAccount = (email, password) => authenticate("register", email, password);
export const signIn = (email, password) => authenticate("login", email, password);

export async function signOut() {
  await authRequest("logout", { method: "POST", body: {} });
  updateSession(null, true);
}

export function onAuthStateChange(callback) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

if (typeof window !== "undefined") window.addEventListener("focus", refreshSession);
if (channel) channel.onmessage = refreshSession;
