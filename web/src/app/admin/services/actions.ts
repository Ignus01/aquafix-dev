"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth";
import { friendlyError } from "@/lib/db-errors";
import { SERVICE_READERS, SERVICE_WRITERS } from "@/lib/services/permissions";
import type {
  AssetOption,
  FieldErrors,
  SaveServicePayload,
  ServiceDetail,
  ServiceFileRow,
  ServiceListRow,
  SupplierOption,
} from "@/lib/services/types";

// Same model as the other sections: every call runs with the caller's own
// session, so RLS and save_service's checks are the real gate.

const BUCKET = "service-files";
const DOWNLOAD_URL_TTL = 60;

type ActionResult = { error: string | null };

function revalidate(reference?: number) {
  revalidatePath("/admin/services");
  if (reference !== undefined) revalidatePath(`/admin/services/${reference}`);
}

// ============================================================================
// Reads
// ============================================================================
const LIST_COLUMNS =
  "id, reference, service_type, due_date, is_completed, completed_date, invoice_nr, " +
  "total_part_cost, total_labour_cost, total_cost, comment, performed_by, " +
  "asset:asset_id(id, code, name), supplier:supplier_id(id, name)";

export async function getAppTimeZone(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("app_time_zone");
  return (data as string | null) ?? "Africa/Johannesburg";
}

// Service_Overview: every service, newest due date first. Capped at the API's
// max_rows (1000); the grid filters client-side.
export async function listServices(): Promise<ServiceListRow[]> {
  await requireRole(SERVICE_READERS);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("service")
    .select(LIST_COLUMNS)
    .order("due_date", { ascending: false })
    .limit(1000);
  if (error) throw error;
  return data as unknown as ServiceListRow[];
}

// Service_Overview_PWA: open services ([IsCompleted = false]), soonest due first.
export async function listOpenServices(): Promise<ServiceListRow[]> {
  await requireRole(SERVICE_READERS);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("service")
    .select(LIST_COLUMNS)
    .eq("is_completed", false)
    .order("due_date")
    .limit(1000);
  if (error) throw error;
  return data as unknown as ServiceListRow[];
}

export async function getServiceDetail(reference: number): Promise<ServiceDetail | null> {
  await requireRole(SERVICE_READERS);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("service")
    .select(LIST_COLUMNS)
    .eq("reference", reference)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const service = data as unknown as ServiceListRow;

  const { data: files, error: filesError } = await supabase
    .from("service_file")
    .select("id, name, size_bytes, created_at, created_by")
    .eq("service_id", service.id)
    .order("created_at");
  if (filesError) throw filesError;

  const rawFiles = files as { id: string; name: string; size_bytes: number; created_at: string; created_by: string | null }[];
  const names = new Map<string, string>();
  const ids = [...new Set(rawFiles.map((f) => f.created_by).filter((id): id is string => Boolean(id)))];
  if (ids.length > 0) {
    const { data: rows, error: namesError } = await supabase.rpc("get_user_names", { p_ids: ids });
    if (namesError) throw namesError;
    for (const row of (rows ?? []) as { id: string; name: string }[]) names.set(row.id, row.name);
  }

  return {
    ...service,
    files: rawFiles.map(
      (f): ServiceFileRow => ({
        id: f.id,
        name: f.name,
        size_bytes: f.size_bytes,
        created_at: f.created_at,
        created_by_name: f.created_by ? (names.get(f.created_by) ?? null) : null,
      }),
    ),
  };
}

// Pickers on Service_NewEdit: every asset (an existing service keeps its
// asset even if it was deactivated) and the organisations marked as service
// suppliers.
export async function listServiceFormOptions(): Promise<{
  assets: AssetOption[];
  suppliers: SupplierOption[];
}> {
  await requireRole(SERVICE_READERS);
  const supabase = await createClient();
  const [assets, suppliers] = await Promise.all([
    supabase.from("asset").select("id, name, code, active").order("name"),
    supabase
      .from("organisation")
      .select("id, name, active")
      .eq("is_service_supplier", true)
      .order("name"),
  ]);
  if (assets.error) throw assets.error;
  if (suppliers.error) throw suppliers.error;
  return { assets: assets.data, suppliers: suppliers.data };
}

// ServiceFile download: a short-lived signed URL that saves under the real name.
export async function getServiceFileUrl(fileId: string): Promise<{ error: string | null; url?: string }> {
  await requireRole(SERVICE_READERS);
  const supabase = await createClient();
  const { data: file, error } = await supabase
    .from("service_file")
    .select("storage_path, name")
    .eq("id", fileId)
    .maybeSingle();
  if (error) return { error: friendlyError(error) };
  if (!file) return { error: "That file no longer exists." };
  const { data, error: urlError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(file.storage_path, DOWNLOAD_URL_TTL, { download: file.name });
  if (urlError || !data) return { error: "Couldn't prepare the download." };
  return { error: null, url: data.signedUrl };
}

// ============================================================================
// Writes
// ============================================================================
async function removeFiles(supabase: SupabaseClient, paths: string[]) {
  if (paths.length === 0) return;
  // Best effort: nothing references these any more.
  await supabase.storage.from(BUCKET).remove(paths);
}

// ACT_Service_Save: field checks mirror Service_Validate; save_service repeats
// every check server-side, including the one-open-service-per-asset rule.
export async function saveService(payload: SaveServicePayload): Promise<{
  error: string | null;
  fieldErrors?: FieldErrors;
  reference?: number;
  // Set when completing a scheduled maintenance opened the next one.
  nextService?: { id: string; reference: number };
}> {
  await requireRole(SERVICE_WRITERS);

  const fieldErrors: FieldErrors = {};
  if (!payload.service_type) fieldErrors.service_type = "Required";
  if (!payload.due_date) fieldErrors.due_date = "Required";
  if (!payload.asset_id) fieldErrors.asset_id = "Required";
  if (payload.is_completed) {
    if (!payload.completed_date) fieldErrors.completed_date = "Required";
    if (!payload.supplier_id) fieldErrors.supplier_id = "Required";
  }
  if (Object.keys(fieldErrors).length > 0) return { error: null, fieldErrors };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_service", { p_service: payload });
  if (error) return { error: friendlyError(error) };

  const result = data as {
    id: string;
    reference: number;
    removed_paths: string[];
    next_service: { id: string; reference: number } | null;
  };
  await removeFiles(supabase, result.removed_paths ?? []);
  revalidate(result.reference);
  return {
    error: null,
    reference: result.reference,
    nextService: result.next_service ?? undefined,
  };
}

// Service_Overview's Delete (writers). Files go with the service; their
// Storage objects are removed with the service role, since a `user` can't
// remove files other people uploaded.
export async function deleteService(id: string): Promise<ActionResult> {
  await requireRole(SERVICE_WRITERS);
  const supabase = await createClient();

  const { data: files } = await supabase.from("service_file").select("storage_path").eq("service_id", id);
  const { data: deleted, error } = await supabase.from("service").delete().eq("id", id).select("id");
  if (error) return { error: friendlyError(error) };
  if (!deleted || deleted.length === 0) {
    return { error: "You don't have permission to delete this service." };
  }

  await removeFiles(
    createAdminClient(),
    (files ?? []).map((f) => f.storage_path),
  );
  revalidate();
  return { error: null };
}
