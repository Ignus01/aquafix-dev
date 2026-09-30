"use client";

import { createClient } from "@/lib/supabase/client";
import type { NewFile } from "./types";

export const SERVICE_FILE_BUCKET = "service-files";
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

// Uploads into the caller's own Storage folder (the bucket policy only allows
// `<user id>/…`). save_service links the path to the service.
export async function uploadServiceFile(file: File): Promise<NewFile> {
  if (file.size === 0) throw new Error("That file is empty.");
  if (file.size > MAX_FILE_BYTES) throw new Error("Files can be at most 25 MB.");

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Your session has expired. Sign in again.");

  // Storage keys are restricted to a safe character set; the real name is
  // kept in the service_file row.
  const safeName = file.name.replace(/[^\w.-]+/g, "_").slice(-80);
  const path = `${user.id}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage
    .from(SERVICE_FILE_BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw new Error("Upload failed. Check your connection and try again.");

  return {
    name: file.name,
    storage_path: path,
    mime_type: file.type || null,
    size_bytes: file.size,
  };
}

// Best-effort clean-up of uploads that were never linked (removed from the
// form, or the form was cancelled). The caller can only delete their own files.
export async function discardServiceUploads(files: NewFile[]): Promise<void> {
  if (files.length === 0) return;
  try {
    await createClient()
      .storage.from(SERVICE_FILE_BUCKET)
      .remove(files.map((f) => f.storage_path));
  } catch {
    // Orphaned files are harmless; nothing links to them.
  }
}
