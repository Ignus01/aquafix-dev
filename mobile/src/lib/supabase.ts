// The Supabase client: Auth (same accounts as the web app), the RPC calls the
// upload queue makes, and Storage for photos. Screens never call it; they
// read and write the local database only.
import { createClient, type Session } from "@supabase/supabase-js";
import { AppState } from "react-native";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "../config";
import { getSecure, removeSecure, secureAuthStorage, setSecure } from "./secure-storage";

export const supabase = createClient(SUPABASE_URL || "http://localhost", SUPABASE_PUBLISHABLE_KEY || "missing", {
  auth: {
    storage: secureAuthStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

// Refresh tokens only while the app is in the foreground (Supabase's advice
// for React Native).
AppState.addEventListener("change", (state) => {
  if (state === "active") supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});

// ---- The phone's owner ---------------------------------------------------------
// Each phone belongs to one inspector. Who that is is kept apart from the
// Supabase session, so the app opens and captures offline even when the
// session has expired and can't be refreshed yet.
export type PhoneUser = { id: string; email: string };
const OWNER_KEY = "aquafix.owner";
const REAUTH_KEY = "aquafix.needs_sign_in";

export async function getPhoneUser(): Promise<PhoneUser | null> {
  const raw = await getSecure(OWNER_KEY);
  return raw ? (JSON.parse(raw) as PhoneUser) : null;
}

export async function setPhoneUser(user: PhoneUser): Promise<void> {
  await setSecure(OWNER_KEY, JSON.stringify(user));
}

export async function clearPhoneUser(): Promise<void> {
  await removeSecure(OWNER_KEY);
  await removeSecure(REAUTH_KEY);
}

// Set when the session can't be refreshed (refresh token revoked or expired):
// uploads wait and the user is asked to sign in again. Queued work is kept.
export async function needsSignIn(): Promise<boolean> {
  return (await getSecure(REAUTH_KEY)) === "1";
}

export async function setNeedsSignIn(value: boolean): Promise<void> {
  if (value) await setSecure(REAUTH_KEY, "1");
  else await removeSecure(REAUTH_KEY);
}

const listeners = new Set<(v: boolean) => void>();
export function onNeedsSignInChange(fn: (v: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export async function flagNeedsSignIn(): Promise<void> {
  await setNeedsSignIn(true);
  listeners.forEach((fn) => fn(true));
}
export function clearNeedsSignInFlag(): void {
  void setNeedsSignIn(false);
  listeners.forEach((fn) => fn(false));
}

// Network failures look like this in supabase-js; anything else from a
// refresh means the session is gone.
function isRetryableAuthError(e: unknown): boolean {
  const err = e as { name?: string; message?: string; status?: number } | null;
  if (!err) return false;
  if (err.name === "AuthRetryableFetchError") return true;
  if ((err.status ?? 0) >= 500 || err.status === 0) return true;
  return /network|fetch|timeout/i.test(err.message ?? "");
}

// A valid session for an upload or a sync, refreshing it first if it has
// expired. Throws when there is none: a network problem means "try later";
// a dead session flags "sign in again" (and also throws, so uploads wait).
export async function requireSession(): Promise<Session> {
  const { data, error } = await supabase.auth.getSession();
  const session = data.session;
  if (session && session.expires_at && session.expires_at * 1000 > Date.now() + 30_000) return session;

  const refreshed = await supabase.auth.refreshSession();
  if (refreshed.data.session) return refreshed.data.session;
  const failure = refreshed.error ?? error;
  if (failure && !isRetryableAuthError(failure)) {
    await flagNeedsSignIn();
    throw new Error("Your session has expired. Sign in again to upload.");
  }
  throw new Error("No connection to refresh the session.");
}
