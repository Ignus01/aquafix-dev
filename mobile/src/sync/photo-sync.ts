// Photo files and Storage, for the upload queue and after each sync.
import type { CommonPowerSyncDatabase } from "@powersync/react-native";
import { File } from "expo-file-system";
import { isAlreadyUploaded, isTransientStorageError } from "../domain/upload-errors";
import { supabase } from "../lib/supabase";
import { type Command, commandBucket, payloadImages } from "../commands/types";
import { photoIdFromPath, photosDir } from "../photos/photos";

type PhotoFile = {
  id: string;
  bucket: string;
  storage_path: string;
  thumbnail_path: string | null;
  local_uri: string | null;
  thumb_uri: string | null;
  mime_type: string | null;
  uploaded: number;
};

class TransientUpload extends Error {
  transient = true;
}

async function uploadOne(bucket: string, path: string, uri: string, contentType: string): Promise<void> {
  const file = new File(uri);
  if (!file.exists) throw new Error("A photo file is missing from the phone. Remove that photo and save again.");
  const body = await file.arrayBuffer();
  let result;
  try {
    result = await supabase.storage.from(bucket).upload(path, body, { contentType, upsert: false });
  } catch (e) {
    throw new TransientUpload(e instanceof Error ? e.message : String(e));
  }
  if (!result.error) return;
  const err = result.error as unknown as { statusCode?: string; status?: number; message?: string; error?: string };
  // The path is fixed per photo: "already exists" means an earlier attempt got there.
  if (isAlreadyUploaded(err)) return;
  if (isTransientStorageError(err)) throw new TransientUpload(err.message ?? "Photo upload failed.");
  throw new Error(err.message ?? "Photo upload failed.");
}

// Step 2: upload every photo in the payload that isn't uploaded yet, full
// size and thumbnail, with upsert off. Marks each one uploaded.
export async function uploadCommandPhotos(db: CommonPowerSyncDatabase, cmd: Command, userId: string): Promise<void> {
  const bucket = commandBucket(cmd);
  if (!bucket) return;
  for (const img of payloadImages(cmd)) {
    if ("id" in img) continue;
    if (!img.storage_path.startsWith(`${userId}/`)) continue; // the server refuses it; no upload to try
    const photoId = photoIdFromPath(img.storage_path);
    const row = await db.getOptional<PhotoFile>("SELECT * FROM photo_file WHERE id = ?", [photoId]);
    if (!row || row.uploaded) continue;
    if (!row.local_uri) continue;
    await uploadOne(bucket, img.storage_path, row.local_uri, img.mime_type);
    if (img.thumbnail_path && row.thumb_uri) await uploadOne(bucket, img.thumbnail_path, row.thumb_uri, "image/jpeg");
    await db.execute("UPDATE photo_file SET uploaded = 1 WHERE id = ?", [photoId]);
  }
}

function deleteLocal(uri: string | null): void {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Left for the startup sweep.
  }
}

// Step 4, success: delete the Storage files the server unlinked (except any
// path this payload sends as a photo), and the local full-size files of the
// photos that went up. Thumbnails stay as the cache for the server's rows.
export async function afterConfirmedSave(db: CommonPowerSyncDatabase, cmd: Command, result: unknown): Promise<void> {
  const bucket = commandBucket(cmd);
  if (!bucket) return;
  const sent = new Set(
    payloadImages(cmd).flatMap((i) => ("id" in i ? [] : [i.storage_path, i.thumbnail_path])),
  );
  const removed = ((result as { removed_paths?: string[] } | null)?.removed_paths ?? []).filter((p) => !sent.has(p));
  if (removed.length > 0) {
    try {
      await supabase.storage.from(bucket).remove(removed);
    } catch {
      // Orphaned files are harmless; nothing links to them.
    }
  }
  for (const img of payloadImages(cmd)) {
    if ("id" in img) continue;
    const photoId = photoIdFromPath(img.storage_path);
    const row = await db.getOptional<PhotoFile>("SELECT * FROM photo_file WHERE id = ?", [photoId]);
    if (!row) continue;
    deleteLocal(row.local_uri);
    await db.execute("UPDATE photo_file SET local_uri = NULL, uploaded = 1 WHERE id = ?", [photoId]);
  }
}

// After each sync: download any thumbnail of a synced photo row the phone
// doesn't have yet, through a 1-hour signed URL (the buckets are private).
export async function downloadMissingThumbnails(db: CommonPowerSyncDatabase): Promise<void> {
  const rows = await db.getAll<{ bucket: string; storage_path: string; thumbnail_path: string | null }>(
    `SELECT 'inspection-images' AS bucket, i.storage_path, i.thumbnail_path FROM inspection_image i
       WHERE NOT EXISTS (SELECT 1 FROM photo_file f WHERE f.storage_path = i.storage_path OR f.id = i.id)
     UNION ALL
     SELECT 'incident-images' AS bucket, i.storage_path, i.thumbnail_path FROM incident_image i
       WHERE NOT EXISTS (SELECT 1 FROM photo_file f WHERE f.storage_path = i.storage_path OR f.id = i.id)
     LIMIT 200`,
  );
  if (rows.length === 0) return;
  const dir = photosDir();
  for (const r of rows) {
    const source = r.thumbnail_path ?? r.storage_path;
    const { data, error } = await supabase.storage.from(r.bucket).createSignedUrl(source, 3600);
    if (error || !data?.signedUrl) continue;
    const photoId = photoIdFromPath(r.storage_path);
    const target = new File(dir, `${photoId}_thumb.jpg`);
    try {
      if (target.exists) target.delete();
      await File.downloadFileAsync(data.signedUrl, target);
    } catch {
      continue;
    }
    if (await db.getOptional("SELECT id FROM photo_file WHERE id = ?", [photoId])) continue;
    await db.execute(
      `INSERT INTO photo_file (id, bucket, storage_path, thumbnail_path, local_uri, thumb_uri, mime_type, size_bytes, uploaded, taken_here, created_at)
       VALUES (?, ?, ?, ?, NULL, ?, 'image/jpeg', 1, 1, 0, ?)`,
      [photoId, r.bucket, r.storage_path, r.thumbnail_path, target.uri, new Date().toISOString()],
    );
  }
}

// A cached file is deleted when its row leaves the phone. Photos taken here
// stay while anything waits to upload or a Needs attention item names them.
export async function cleanupPhotoFiles(db: CommonPowerSyncDatabase): Promise<void> {
  const queue = await db.getUploadQueueStats();
  if (queue.count > 0) return;
  const stale = await db.getAll<PhotoFile>(
    `SELECT f.* FROM photo_file f
     WHERE NOT EXISTS (SELECT 1 FROM inspection_image i WHERE i.storage_path = f.storage_path)
       AND NOT EXISTS (SELECT 1 FROM incident_image i WHERE i.storage_path = f.storage_path)
       AND NOT EXISTS (SELECT 1 FROM needs_attention n WHERE instr(n.payload, f.storage_path) > 0)`,
  );
  for (const f of stale) {
    deleteLocal(f.local_uri);
    deleteLocal(f.thumb_uri);
    await db.execute("DELETE FROM photo_file WHERE id = ?", [f.id]);
  }
  // Files no row points at (a form closed by killing the app).
  const known = new Set(
    (await db.getAll<{ uri: string }>(
      "SELECT local_uri AS uri FROM photo_file WHERE local_uri IS NOT NULL UNION SELECT thumb_uri FROM photo_file WHERE thumb_uri IS NOT NULL",
    )).map((r) => r.uri),
  );
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  for (const entry of photosDir().list()) {
    if (!(entry instanceof File) || known.has(entry.uri)) continue;
    const modified = entry.modificationTime ?? 0;
    if (modified && modified < dayAgo) deleteLocal(entry.uri);
  }
}

// Full-size images are fetched only when the user opens one online.
export async function fullImageUrl(bucket: string, storagePath: string): Promise<string | null> {
  const local = await localFullUri(storagePath);
  if (local) return local;
  const { data } = await supabase.storage.from(bucket).createSignedUrl(storagePath, 3600);
  return data?.signedUrl ?? null;
}

let dbRef: CommonPowerSyncDatabase | null = null;
export function setPhotoDb(db: CommonPowerSyncDatabase): void {
  dbRef = db;
}
async function localFullUri(storagePath: string): Promise<string | null> {
  if (!dbRef) return null;
  const row = await dbRef.getOptional<{ local_uri: string | null }>("SELECT local_uri FROM photo_file WHERE id = ?", [
    photoIdFromPath(storagePath),
  ]);
  return row?.local_uri ?? null;
}
