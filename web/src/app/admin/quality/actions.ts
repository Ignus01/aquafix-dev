"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/supabase/select-all";
import { friendlyError } from "@/lib/db-errors";
import { QUALITY_ADMINS, QUALITY_READERS } from "@/lib/quality/permissions";
import { LAB_RESULTS_BUCKET } from "@/lib/quality/constants";
import type { LabImportRow, QualityFilter, ResultRow, SampleOverview } from "@/lib/quality/types";

// Quality → Lab Results. Reads use the caller's session (RLS: every
// masterdata role reads); deletes are system admin / admin only, here and in
// the database.

type ActionResult = { error: string | null };
type Supabase = Awaited<ReturnType<typeof createClient>>;

const DOWNLOAD_URL_TTL = 60;

function revalidate() {
  revalidatePath("/admin/quality", "layout");
}

async function userNames(supabase: Supabase, ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const { data } = await supabase.rpc("get_user_names", { p_ids: unique });
  for (const row of (data ?? []) as { id: string; name: string }[]) map.set(row.id, row.name);
  return map;
}

const SAMPLE_COLUMNS =
  "id, import_id, lab_id, location_id, location_name, lab_no, lab_locality, sample_type, sampled_on, lab_name, " +
  "batch_no, client_name, file_name, imported_at, imported_by, results, out_of_spec, inconclusive, out_of_spec_names";

type SampleRecord = Omit<SampleOverview, "imported_by_name"> & { imported_by: string | null };

async function withNames(supabase: Supabase, rows: SampleRecord[]): Promise<SampleOverview[]> {
  const names = await userNames(supabase, rows.map((r) => r.imported_by));
  return rows.map(({ imported_by, ...r }) => ({
    ...r,
    imported_by_name: imported_by ? (names.get(imported_by) ?? null) : null,
  }));
}

// Samples matching the filters, newest first. With imports chosen (the link
// after an import), the period doesn't apply.
export async function listSamples(filter: QualityFilter, importIds: string[] = []): Promise<SampleOverview[]> {
  await requireRole(QUALITY_READERS);
  const supabase = await createClient();
  const rows = await selectAll(() => {
    let q = supabase.from("lab_sample_overview").select(SAMPLE_COLUMNS);
    if (importIds.length > 0) q = q.in("import_id", importIds);
    else q = q.gte("sampled_on", filter.from).lte("sampled_on", filter.to);
    if (filter.region) q = q.eq("region_id", filter.region);
    if (filter.organisation) q = q.eq("organisation_id", filter.organisation);
    if (filter.location) q = q.eq("location_id", filter.location);
    if (filter.lab) q = q.eq("lab_id", filter.lab);
    if (filter.outOfSpec) q = q.gt("out_of_spec", 0);
    return q.order("sampled_on", { ascending: false }).order("lab_no", { ascending: false }).order("id");
  });
  return withNames(supabase, rows as unknown as SampleRecord[]);
}

const RESULT_COLUMNS =
  "id, sample_id, parameter_id, raw_value, value, below_detection, lab_parameter, lab_unit, parameter_name, " +
  "parameter_short_name, unit, min_acceptable, max_acceptable, decimals, sort_order, status";

// numeric columns arrive as numbers or strings depending on size.
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
function toResult(r: Record<string, unknown>): ResultRow {
  return {
    ...(r as unknown as ResultRow),
    raw_value: Number(r.raw_value),
    value: Number(r.value),
    min_acceptable: num(r.min_acceptable),
    max_acceptable: num(r.max_acceptable),
  };
}

// The By location grid: one location's samples in the period (and lab /
// out-of-spec filters), with all their results.
export async function getLocationGrid(
  filter: QualityFilter,
): Promise<{ samples: SampleOverview[]; results: ResultRow[] }> {
  await requireRole(QUALITY_READERS);
  if (!filter.location) return { samples: [], results: [] };
  const samples = await listSamples(filter);
  if (samples.length === 0) return { samples, results: [] };
  const supabase = await createClient();
  const ids = samples.map((s) => s.id);
  const results: ResultRow[] = [];
  // Keep each request's id list (in the URL) short.
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const rows = await selectAll(() =>
      supabase.from("lab_result_view").select(RESULT_COLUMNS).in("sample_id", chunk).order("id"),
    );
    results.push(...(rows as unknown as Record<string, unknown>[]).map(toResult));
  }
  return { samples, results };
}

export async function getSample(id: string): Promise<{ sample: SampleOverview; results: ResultRow[] } | null> {
  await requireRole(QUALITY_READERS);
  const supabase = await createClient();
  const { data, error } = await supabase.from("lab_sample_overview").select(SAMPLE_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const [sample] = await withNames(supabase, [data as unknown as SampleRecord]);
  const { data: results, error: resultsError } = await supabase
    .from("lab_result_view")
    .select(RESULT_COLUMNS)
    .eq("sample_id", id)
    .order("sort_order")
    .order("parameter_name");
  if (resultsError) throw resultsError;
  return { sample, results: (results as unknown as Record<string, unknown>[]).map(toResult) };
}

export async function listImports(): Promise<LabImportRow[]> {
  await requireRole(QUALITY_READERS);
  const supabase = await createClient();
  const rows = (await selectAll(() =>
    supabase
      .from("lab_import")
      .select(
        "id, lab_id, lab_name, client_name, batch_no, file_name, status, samples_imported, samples_skipped, " +
          "created_at, created_by, imported_at, imported_by",
      )
      .order("created_at", { ascending: false })
      .order("id"),
  )) as unknown as (Omit<LabImportRow, "created_by_name" | "imported_by_name"> & {
    created_by: string | null;
    imported_by: string | null;
  })[];
  const names = await userNames(supabase, rows.flatMap((r) => [r.created_by, r.imported_by]));
  return rows.map(({ created_by, imported_by, ...r }) => ({
    ...r,
    created_by_name: created_by ? (names.get(created_by) ?? null) : null,
    imported_by_name: imported_by ? (names.get(imported_by) ?? null) : null,
  }));
}

export async function listFilterOptions() {
  await requireRole(QUALITY_READERS);
  const supabase = await createClient();
  // Users can't read regions (RLS), so their region list is empty.
  const [regions, organisations, locations, labs] = await Promise.all([
    supabase.from("region").select("id, name").eq("active", true).order("name"),
    supabase.from("organisation").select("id, name").eq("active", true).order("name"),
    selectAll(() =>
      supabase.from("location").select("id, name, region_id, organisation_id, active").order("name").order("id"),
    ),
    supabase.from("lab").select("id, name").order("name"),
  ]);
  return {
    regions: regions.data ?? [],
    organisations: organisations.data ?? [],
    locations: locations as { id: string; name: string; region_id: string; organisation_id: string; active: boolean }[],
    labs: labs.data ?? [],
  };
}

export async function getImportFileUrl(importId: string): Promise<{ error: string | null; url?: string }> {
  await requireRole(QUALITY_READERS);
  const supabase = await createClient();
  const { data: imp, error } = await supabase
    .from("lab_import")
    .select("storage_path, file_name, status")
    .eq("id", importId)
    .maybeSingle();
  if (error) return { error: friendlyError(error) };
  if (!imp || imp.status === "cancelled") return { error: "That file is no longer available." };
  const { data, error: urlError } = await supabase.storage
    .from(LAB_RESULTS_BUCKET)
    .createSignedUrl(imp.storage_path, DOWNLOAD_URL_TTL, { download: imp.file_name });
  if (urlError || !data) return { error: "Couldn't prepare the download." };
  return { error: null, url: data.signedUrl };
}

// ============================================================================
// Writes (system admins and admins)
// ============================================================================

export async function deleteSample(id: string): Promise<ActionResult> {
  await requireRole(QUALITY_ADMINS);
  const supabase = await createClient();
  const { data, error } = await supabase.from("lab_sample").delete().eq("id", id).select("id");
  if (error) return { error: friendlyError(error) };
  if (!data || data.length === 0) return { error: "You don't have permission to delete this sample." };
  revalidate();
  return { error: null };
}

// Deletes an import with its samples and results, and its file.
export async function deleteImport(id: string): Promise<ActionResult> {
  await requireRole(QUALITY_ADMINS);
  const supabase = await createClient();
  const { data, error } = await supabase.from("lab_import").delete().eq("id", id).select("storage_path");
  if (error) return { error: friendlyError(error) };
  if (!data || data.length === 0) return { error: "You don't have permission to delete this import." };
  // Best effort: nothing references the file any more.
  await supabase.storage.from(LAB_RESULTS_BUCKET).remove(data.map((d) => d.storage_path));
  revalidate();
  return { error: null };
}

// A staged import that won't be imported: kept as cancelled, its file removed.
export async function cancelImports(ids: string[]): Promise<ActionResult> {
  await requireRole(QUALITY_ADMINS);
  if (ids.length === 0) return { error: null };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lab_import")
    .update({ status: "cancelled" })
    .in("id", ids)
    .eq("status", "staged")
    .select("storage_path");
  if (error) return { error: friendlyError(error) };
  if (data && data.length > 0) {
    await supabase.storage.from(LAB_RESULTS_BUCKET).remove(data.map((d) => d.storage_path));
  }
  revalidate();
  return { error: null };
}
