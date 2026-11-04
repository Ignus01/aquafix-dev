// The encrypted local database. op-sqlite is built with SQLCipher
// (package.json "op-sqlite": { "sqlcipher": true }); the key is random per
// install and kept in the Keychain / Keystore.
import { type CommonPowerSyncDatabase, PowerSyncDatabase } from "@powersync/react-native";
import * as Crypto from "expo-crypto";
import { getSecure, setSecure } from "../lib/secure-storage";
import { AppSchema } from "./schema";

const KEY_NAME = "aquafix.db_key";
export const DB_FILENAME = "aquafix-capture.db";

let instance: CommonPowerSyncDatabase | null = null;
let opening: Promise<CommonPowerSyncDatabase> | null = null;

async function encryptionKey(): Promise<string> {
  let key = await getSecure(KEY_NAME);
  if (!key) {
    const bytes = Crypto.getRandomBytes(32);
    key = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    await setSecure(KEY_NAME, key);
  }
  return key;
}

export function openDatabase(): Promise<CommonPowerSyncDatabase> {
  if (instance) return Promise.resolve(instance);
  if (!opening) {
    opening = (async () => {
      const db = new PowerSyncDatabase({
        schema: AppSchema,
        database: { dbFilename: DB_FILENAME, sqliteOptions: { encryptionKey: await encryptionKey() } },
      });
      await db.init();
      instance = db;
      return db;
    })();
  }
  return opening;
}

export function db(): CommonPowerSyncDatabase {
  if (!instance) throw new Error("The database isn't open yet.");
  return instance;
}

// ---- app_setting ----------------------------------------------------------------
export async function getSetting(key: string): Promise<string | null> {
  const row = await db().getOptional<{ value: string }>("SELECT value FROM app_setting WHERE key = ?", [key]);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db().writeTransaction(async (tx) => {
    const row = await tx.getOptional<{ id: string }>("SELECT id FROM app_setting WHERE key = ?", [key]);
    if (row) await tx.execute("UPDATE app_setting SET value = ? WHERE id = ?", [value, row.id]);
    else await tx.execute("INSERT INTO app_setting (id, key, value) VALUES (uuid(), ?, ?)", [key, value]);
  });
}
