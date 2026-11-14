import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

export const authConfigured = Boolean(supabaseUrl && supabasePublishableKey);

const supabase = authConfigured
  ? createClient(supabaseUrl, supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    })
  : null;

function requireClient() {
  if (!supabase) throw new Error("A autenticação ainda não foi configurada.");
  return supabase;
}

export async function getCurrentSession() {
  const { data, error } = await requireClient().auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function sendEmailOtp(email) {
  const { error } = await requireClient().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true }
  });
  if (error) throw error;
}

export async function verifyEmailOtp(email, token) {
  const { data, error } = await requireClient().auth.verifyOtp({ email, token, type: "email" });
  if (error) throw error;
  return data.session;
}

export async function signOut() {
  const { error } = await requireClient().auth.signOut();
  if (error) throw error;
}

export function onAuthStateChange(callback) {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return () => data.subscription.unsubscribe();
}
