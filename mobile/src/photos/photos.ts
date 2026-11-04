// Photos (spec "Photos"). Taken or picked in a form, resized on the phone
// like web/src/lib/incidents/image-upload.ts (1,600 px JPEG at 0.82 plus a
// 400 px thumbnail at 0.72) and kept as files in the app's private storage.
// Uploaded to `<bucket>/<user id>/<photo id>.jpg` and `…_thumb.jpg` by the
// upload queue, before the save that uses them.
import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import type { Transaction } from "@powersync/react-native";

const FULL_MAX = 1600;
const THUMB_MAX = 400;

// A photo on a form. `serverId` is set for a photo the server already has a
// row for (sent as `{id}`); otherwise it is sent as new, by path.
export type FormPhoto = {
  key: string;
  photoId: string;
  serverId: string | null;
  storage_path: string;
  thumbnail_path: string;
  mime_type: string;
  size_bytes: number;
  thumbUri: string | null;
  // Set for a photo taken in this form and not saved yet.
  fresh?: { localUri: string };
};

export type PayloadImage =
  | { id: string }
  | { storage_path: string; thumbnail_path: string; mime_type: string; size_bytes: number };

export function photosDir(): Directory {
  const dir = new Directory(Paths.document, "photos");
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

// The photo id that names a Storage file: `<uid>/<photo id>.jpg` → photo id.
export function photoIdFromPath(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/_thumb\.jpg$/i, "").replace(/\.[a-z0-9]+$/i, "");
}

export function toPayloadImage(p: FormPhoto): PayloadImage {
  if (p.serverId) return { id: p.serverId };
  return { storage_path: p.storage_path, thumbnail_path: p.thumbnail_path, mime_type: p.mime_type, size_bytes: p.size_bytes };
}

async function resize(uri: string, width: number, height: number, maxSide: number, quality: number): Promise<string> {
  const ctx = ImageManipulator.manipulate(uri);
  const scale = Math.min(1, maxSide / Math.max(width, height));
  if (scale < 1) {
    if (width >= height) ctx.resize({ width: Math.round(width * scale) });
    else ctx.resize({ height: Math.round(height * scale) });
  }
  const image = await ctx.renderAsync();
  const saved = await image.saveAsync({ compress: quality, format: SaveFormat.JPEG });
  return saved.uri;
}

export class PhotoPermissionError extends Error {}

// Takes (or picks) one photo, resizes it and keeps both files. Returns null
// when the user backs out.
export async function capturePhoto(source: "camera" | "library", userId: string): Promise<FormPhoto | null> {
  if (source === "camera") {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new PhotoPermissionError("Allow camera access in Settings to take photos.");
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 1, exif: false };
  const result =
    source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || result.assets.length === 0) return null;
  const asset = result.assets[0];

  const photoId = Crypto.randomUUID();
  const [fullUri, thumbUri] = await Promise.all([
    resize(asset.uri, asset.width, asset.height, FULL_MAX, 0.82),
    resize(asset.uri, asset.width, asset.height, THUMB_MAX, 0.72),
  ]);
  const dir = photosDir();
  const full = new File(dir, `${photoId}.jpg`);
  const thumb = new File(dir, `${photoId}_thumb.jpg`);
  await new File(fullUri).move(full);
  await new File(thumbUri).move(thumb);

  return {
    key: photoId,
    photoId,
    serverId: null,
    storage_path: `${userId}/${photoId}.jpg`,
    thumbnail_path: `${userId}/${photoId}_thumb.jpg`,
    mime_type: "image/jpeg",
    size_bytes: Math.max(1, full.size ?? 1),
    thumbUri: thumb.uri,
    fresh: { localUri: full.uri },
  };
}

// Removes the files of photos taken in a form that was cancelled, or taken
// off the form before Save.
export function discardFreshPhotos(photos: FormPhoto[]): void {
  for (const p of photos) {
    if (!p.fresh) continue;
    for (const uri of [p.fresh.localUri, p.thumbUri]) {
      try {
        if (uri) {
          const f = new File(uri);
          if (f.exists) f.delete();
        }
      } catch {
        // A leftover file is harmless; the startup sweep removes it.
      }
    }
  }
}

// In the Save transaction: one photo_file row per photo taken in the form,
// kept until the save is confirmed.
export async function recordFreshPhotos(tx: Transaction, bucket: string, photos: FormPhoto[], now: string): Promise<void> {
  for (const p of photos) {
    if (!p.fresh) continue;
    const exists = await tx.getOptional("SELECT id FROM photo_file WHERE id = ?", [p.photoId]);
    if (exists) continue;
    await tx.execute(
      `INSERT INTO photo_file (id, bucket, storage_path, thumbnail_path, local_uri, thumb_uri, mime_type, size_bytes, uploaded, taken_here, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?)`,
      [p.photoId, bucket, p.storage_path, p.thumbnail_path, p.fresh.localUri, p.thumbUri, p.mime_type, p.size_bytes, now],
    );
  }
}

type ImageRow = { id: string; storage_path: string; thumbnail_path: string | null };
type PhotoFileRow = { id: string; thumb_uri: string | null; local_uri: string | null };

// Photo rows → form photos. A row whose id is a photo_file id was made on
// this phone and hasn't come back from the server yet: it is sent as new
// (by path). Any other row is the server's and is sent as `{id}`.
export function rowsToFormPhotos(rows: ImageRow[], files: Map<string, PhotoFileRow>): FormPhoto[] {
  return rows.map((r) => {
    const photoId = photoIdFromPath(r.storage_path);
    const file = files.get(photoId);
    const madeHere = files.has(r.id);
    return {
      key: r.id,
      photoId,
      serverId: madeHere ? null : r.id,
      storage_path: r.storage_path,
      thumbnail_path: r.thumbnail_path ?? r.storage_path,
      mime_type: "image/jpeg",
      size_bytes: 1,
      thumbUri: file?.thumb_uri ?? null,
    };
  });
}

// Payload images (from a Needs attention item) → form photos.
export function payloadToFormPhotos(images: PayloadImage[], files: Map<string, PhotoFileRow & { size_bytes?: number }>): FormPhoto[] {
  return images.map((img) => {
    if ("id" in img) {
      return {
        key: img.id,
        photoId: img.id,
        serverId: img.id,
        storage_path: "",
        thumbnail_path: "",
        mime_type: "image/jpeg",
        size_bytes: 1,
        thumbUri: null,
      };
    }
    const photoId = photoIdFromPath(img.storage_path);
    const file = files.get(photoId);
    return {
      key: photoId,
      photoId,
      serverId: null,
      storage_path: img.storage_path,
      thumbnail_path: img.thumbnail_path,
      mime_type: img.mime_type,
      size_bytes: img.size_bytes,
      thumbUri: file?.thumb_uri ?? null,
    };
  });
}

export function newKey(): string {
  return Crypto.randomUUID();
}
