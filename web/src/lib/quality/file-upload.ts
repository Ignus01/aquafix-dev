"use client";

import { createClient } from "@/lib/supabase/client";
import { LAB_RESULTS_BUCKET, MAX_LAB_FILE_BYTES } from "./constants";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Uploads a certificate into the caller's own Storage folder (the bucket
// policy only allows `<user id>/…`); stageLabImport then reads it back.
// Returns the Storage path.
export async function uploadLabFile(file: File): Promise<string> {
  if (!/\.xlsx$/i.test(file.name)) throw new Error("Only .xlsx files can be imported.");
  if (file.size === 0) throw new Error("This file is empty or isn't an Excel workbook. Download it from the lab again.");
  if (file.size > MAX_LAB_FILE_BYTES) throw new Error("Files can be at most 10 MB.");

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Your session has expired. Sign in again.");

  // Storage keys are restricted to a safe character set; the real name is
  // kept on the import.
  const safeName = file.name.replace(/[^\w.-]+/g, "_").slice(-80);
  const path = `${user.id}/${crypto.randomUUID()}-${safeName}`;
  const { error } = await supabase.storage
    .from(LAB_RESULTS_BUCKET)
    .upload(path, file, { contentType: XLSX_TYPE, upsert: false });
  if (error) throw new Error("Upload failed. Check your connection and try again.");
  return path;
}
