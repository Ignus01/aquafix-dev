"use client";

import { createClient } from "@/lib/supabase/client";

export const STOCK_DOCUMENT_BUCKET = "stock-documents";
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

export type UploadedFile = {
  name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number;
};

// Uploads into the caller's own Storage folder (the bucket policy only allows
// `<user id>/…`); addDocumentFile then links the path to the load or intake.
export async function uploadStockDocument(file: File): Promise<UploadedFile> {
  if (file.size === 0) throw new Error("That file is empty.");
  if (file.size > MAX_FILE_BYTES) throw new Error("Files can be at most 25 MB.");

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Your session has expired. Sign in again.");

  const safeName = file.name.replace(/[^\w.-]+/g, "_").slice(-80);
  const path = `${user.id}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage
    .from(STOCK_DOCUMENT_BUCKET)
    .upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw new Error("Upload failed. Check your connection and try again.");

  return { name: file.name, storage_path: path, mime_type: file.type || null, size_bytes: file.size };
}
