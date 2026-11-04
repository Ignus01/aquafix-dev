// Connecting, the work done after each sync, and sign-out.
import type { CommonPowerSyncDatabase, SyncStatus } from "@powersync/react-native";
import { Directory, Paths } from "expo-file-system";
import { DEFAULT_TIME_ZONE } from "../domain/dates";
import { setSetting } from "../db/database";
import { clearPhoneUser, supabase } from "../lib/supabase";
import { setSentryUser } from "../lib/sentry";
import { SupabaseConnector } from "./connector";
import { cleanupPhotoFiles, downloadMissingThumbnails, setPhotoDb } from "./photo-sync";

export const TIME_ZONE_KEY = "app_time_zone";
export const LAST_SYNC_KEY = "last_synced_at";

let disposeListener: (() => void) | null = null;
let lastHandled = 0;
let running = false;

// app_time_zone is fetched with its RPC at sign-in and each sync, and cached.
export async function refreshTimeZone(): Promise<void> {
  const { data, error } = await supabase.rpc("app_time_zone");
  if (!error) await setSetting(TIME_ZONE_KEY, (data as string | null) || DEFAULT_TIME_ZONE);
}

async function afterSync(db: CommonPowerSyncDatabase, status: SyncStatus): Promise<void> {
  if (running) return;
  running = true;
  try {
    await setSetting(LAST_SYNC_KEY, (status.lastSyncedAt ?? new Date()).toISOString());
    await refreshTimeZone().catch(() => undefined);
    await downloadMissingThumbnails(db).catch(() => undefined);
    await cleanupPhotoFiles(db).catch(() => undefined);
  } finally {
    running = false;
  }
}

export async function startSync(db: CommonPowerSyncDatabase, userId: string): Promise<void> {
  setPhotoDb(db);
  setSentryUser(userId);
  disposeListener?.();
  disposeListener = db.registerListener({
    statusChanged: (status) => {
      const at = status.lastSyncedAt?.getTime() ?? 0;
      // At most once a minute, and only after a completed sync.
      if (status.connected && at > lastHandled + 60_000) {
        lastHandled = at;
        void afterSync(db, status);
      }
    },
  });
  // Every stream has auto_subscribe: true; no subscription code is needed.
  await db.connect(new SupabaseConnector());
}

export async function pendingUploads(db: CommonPowerSyncDatabase): Promise<number> {
  return (await db.getUploadQueueStats()).count;
}

export class SignOutBlocked extends Error {}

// Sign-out is refused while anything waits to upload, then wipes the
// phone's data: the local database, photo files and the session.
export async function signOutAndWipe(db: CommonPowerSyncDatabase): Promise<void> {
  const waiting = await pendingUploads(db);
  if (waiting > 0) {
    throw new SignOutBlocked(
      `${waiting} save${waiting === 1 ? " is" : "s are"} still waiting to upload. Connect to the internet and wait for them to finish, then sign out.`,
    );
  }
  disposeListener?.();
  disposeListener = null;
  await db.disconnectAndClear({ clearLocal: true });
  try {
    const dir = new Directory(Paths.document, "photos");
    if (dir.exists) dir.delete();
  } catch {
    // Best effort.
  }
  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  await clearPhoneUser();
  setSentryUser(null);
  signedOutListeners.forEach((fn) => fn());
}

// The root layout listens for this to show sign-in again.
const signedOutListeners = new Set<() => void>();
export function onSignedOut(fn: () => void): () => void {
  signedOutListeners.add(fn);
  return () => signedOutListeners.delete(fn);
}
