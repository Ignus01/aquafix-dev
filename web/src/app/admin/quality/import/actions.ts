"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser, getCurrentUserRoles, requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/supabase/select-all";
import { friendlyError } from "@/lib/db-errors";
import { parseLabWorkbook } from "@/lib/quality/parse";
import { LAB_RESULTS_BUCKET, MAX_LAB_FILE_BYTES } from "@/lib/quality/constants";
import { NOT_QUALITY_ADMIN, QUALITY_ADMINS, isQualityAdmin } from "@/lib/quality/permissions";
import type { ParsedSheet, StagedImport } from "@/lib/quality/types";
import { listLabs, listLocationMaps, listParameterMaps, listParameters } from "../parameters/actions";

// Quality → Import: Upload → Map → Preview → Import. Each uploaded file is
// parsed here and kept as a staged lab_import; commit_lab_import() imports
// the chosen staged files in one transaction.

export type ImportLocation = { id: string; name: string; active: boolean };

// The browser has already uploaded the file to its own folder of the
// `lab-results` bucket.
export async function stageLabImport(
  storagePath: string,
  fileName: string,
): Promise<{ error: string; import?: undefined } | { error: null; import: StagedImport }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Your session has expired. Sign in again." };
  if (!isQualityAdmin(await getCurrentUserRoles())) return { error: NOT_QUALITY_ADMIN };
  if (!storagePath.startsWith(`${user.id}/`)) return { error: "That upload doesn't belong to you." };

  const supabase = await createClient();
  const discard = () => supabase.storage.from(LAB_RESULTS_BUCKET).remove([storagePath]);

  const { data: blob, error: downloadError } = await supabase.storage.from(LAB_RESULTS_BUCKET).download(storagePath);
  if (downloadError || !blob) return { error: "The upload couldn't be read back. Try again." };
  if (blob.size > MAX_LAB_FILE_BYTES) {
    await discard();
    return { error: "Files can be at most 10 MB." };
  }

  const parsed = await parseLabWorkbook(await blob.arrayBuffer());
  if ("error" in parsed) {
    await discard();
    return { error: parsed.error };
  }

  const { data, error } = await supabase
    .from("lab_import")
    .insert({
      lab_name: parsed.lab_name,
      client_name: parsed.client_name,
      batch_no: parsed.batch_no,
      file_name: fileName.trim() || "certificate.xlsx",
      storage_path: storagePath,
      parsed,
    })
    .select("id")
    .single();
  if (error) {
    await discard();
    return { error: friendlyError(error) };
  }
  revalidatePath("/admin/quality", "layout");
  return {
    error: null,
    import: {
      id: data.id,
      file_name: fileName,
      lab_name: parsed.lab_name,
      client_name: parsed.client_name,
      batch_no: parsed.batch_no,
      parsed,
    },
  };
}

// Everything the Map and Preview steps need for these staged imports.
export async function getImportContext(importIds: string[]) {
  await requireRole(QUALITY_ADMINS);
  const supabase = await createClient();
  const ids = importIds.slice(0, 100);
  const [imports, labs, parameters, parameterMaps, locationMaps, locations] = await Promise.all([
    ids.length
      ? supabase
          .from("lab_import")
          .select("id, file_name, lab_name, client_name, batch_no, parsed")
          .in("id", ids)
          .eq("status", "staged")
          .order("created_at")
          .order("id")
      : null,
    listLabs(),
    listParameters(),
    listParameterMaps(),
    listLocationMaps(),
    selectAll(() => supabase.from("location").select("id, name, active").order("name").order("id")),
  ]);
  if (imports?.error) throw imports.error;
  const staged = (imports?.data ?? []) as unknown as (Omit<StagedImport, "parsed"> & { parsed: ParsedSheet })[];

  // Lab nos already imported, by lab.
  const labNos = [...new Set(staged.flatMap((i) => i.parsed.rows.map((r) => r.lab_no)))];
  const existing: { lab_id: string; lab_no: string }[] = [];
  for (let i = 0; i < labNos.length; i += 200) {
    const { data, error } = await supabase
      .from("lab_sample")
      .select("lab_id, lab_no")
      .in("lab_no", labNos.slice(i, i + 200));
    if (error) throw error;
    existing.push(...data);
  }

  return {
    imports: staged,
    labs,
    parameters,
    parameterMaps,
    locationMaps,
    locations: locations as ImportLocation[],
    existing,
  };
}

export type ImportContext = Awaited<ReturnType<typeof getImportContext>>;

export type CommitInput = {
  importIds: string[];
  // Lab name as in A1 → an existing lab id to file it under.
  lab: Record<string, string>;
  parameterMaps: {
    lab_name: string;
    lab_parameter: string;
    lab_unit: string | null;
    parameter_id: string | null;
    factor: number;
  }[];
  locationMaps: { lab_name: string; lab_locality: string; location_id: string | null }[];
  replace: boolean;
};

export async function commitLabImport(
  input: CommitInput,
): Promise<{ error: string | null; result?: { files: number; imported: number; skipped: number; replaced: number } }> {
  if (!isQualityAdmin(await getCurrentUserRoles())) return { error: NOT_QUALITY_ADMIN };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("commit_lab_import", {
    p_import_ids: input.importIds,
    p_lab: input.lab,
    p_parameter_maps: input.parameterMaps,
    p_location_maps: input.locationMaps,
    p_replace: input.replace,
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/admin/quality", "layout");
  return { error: null, result: data };
}
