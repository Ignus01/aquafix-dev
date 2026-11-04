// Supabase Auth storage in the iOS Keychain / Android Keystore
// (expo-secure-store), so the refresh token survives restarts and the app
// opens offline after the first sign-in. A session JSON can exceed what one
// SecureStore entry holds (about 2 KB on some devices), so values are split
// into chunks.
import * as SecureStore from "expo-secure-store";

const CHUNK = 1800;
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

// SecureStore keys allow only [A-Za-z0-9._-].
const safe = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, "_");

export async function getSecure(key: string): Promise<string | null> {
  const k = safe(key);
  const count = await SecureStore.getItemAsync(`${k}.n`, OPTIONS);
  if (count === null) return SecureStore.getItemAsync(k, OPTIONS);
  const parts: string[] = [];
  for (let i = 0; i < Number(count); i++) {
    const part = await SecureStore.getItemAsync(`${k}.${i}`, OPTIONS);
    if (part === null) return null;
    parts.push(part);
  }
  return parts.join("");
}

export async function setSecure(key: string, value: string): Promise<void> {
  const k = safe(key);
  await removeSecure(key);
  const n = Math.ceil(value.length / CHUNK);
  for (let i = 0; i < n; i++) {
    await SecureStore.setItemAsync(`${k}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK), OPTIONS);
  }
  await SecureStore.setItemAsync(`${k}.n`, String(n), OPTIONS);
}

export async function removeSecure(key: string): Promise<void> {
  const k = safe(key);
  const count = await SecureStore.getItemAsync(`${k}.n`, OPTIONS);
  if (count !== null) {
    for (let i = 0; i < Number(count); i++) await SecureStore.deleteItemAsync(`${k}.${i}`, OPTIONS);
    await SecureStore.deleteItemAsync(`${k}.n`, OPTIONS);
  }
  await SecureStore.deleteItemAsync(k, OPTIONS);
}

export const secureAuthStorage = {
  getItem: getSecure,
  setItem: setSecure,
  removeItem: removeSecure,
};
