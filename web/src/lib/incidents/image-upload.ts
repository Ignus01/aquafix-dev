"use client";

import { createClient } from "@/lib/supabase/client";
import type { NewImage } from "./types";

export const INCIDENT_IMAGE_BUCKET = "incident-images";

// Phone photos are 3–8 MB. They're resized in the browser before upload
// (migration notes: "Resize or compress on upload"), plus a small thumbnail
// for the galleries (Mendix's System.Image thumbnail).
const FULL_MAX = 1600;
const THUMB_MAX = 400;

async function resize(bitmap: ImageBitmap, maxSide: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Your browser can't process images.");
  ctx.drawImage(bitmap, 0, 0, width, height);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Couldn't process that image."))),
      "image/jpeg",
      quality,
    ),
  );
}

// Uploads a photo into the caller's own Storage folder (the bucket policy
// only allows `<user id>/…`). The returned paths are linked to an incident or
// note by save_incident / add_incident_note.
export async function uploadIncidentImage(
  file: File,
): Promise<{ image: NewImage; previewUrl: string }> {
  if (!file.type.startsWith("image/")) throw new Error("Only images can be added.");

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error("Couldn't read that image. Try a JPEG or PNG photo.");
  }
  const [full, thumb] = await Promise.all([
    resize(bitmap, FULL_MAX, 0.82),
    resize(bitmap, THUMB_MAX, 0.72),
  ]);
  bitmap.close();

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Your session has expired. Sign in again.");

  const base = `${user.id}/${crypto.randomUUID()}`;
  const storage = supabase.storage.from(INCIDENT_IMAGE_BUCKET);
  const [fullRes, thumbRes] = await Promise.all([
    storage.upload(`${base}.jpg`, full, { contentType: "image/jpeg", upsert: false }),
    storage.upload(`${base}_thumb.jpg`, thumb, { contentType: "image/jpeg", upsert: false }),
  ]);
  if (fullRes.error || thumbRes.error) {
    await storage.remove([`${base}.jpg`, `${base}_thumb.jpg`]);
    throw new Error("Upload failed. Check your connection and try again.");
  }

  return {
    image: {
      storage_path: `${base}.jpg`,
      thumbnail_path: `${base}_thumb.jpg`,
      mime_type: "image/jpeg",
      size_bytes: full.size,
    },
    previewUrl: URL.createObjectURL(thumb),
  };
}

// Best-effort clean-up of uploads that were never linked (removed from the
// form, or the form was cancelled). The caller can only delete their own files.
export async function discardUploads(images: NewImage[]): Promise<void> {
  const paths = images.flatMap((i) => [i.storage_path, i.thumbnail_path]);
  if (paths.length === 0) return;
  try {
    await createClient().storage.from(INCIDENT_IMAGE_BUCKET).remove(paths);
  } catch {
    // Orphaned files are harmless; nothing links to them.
  }
}
