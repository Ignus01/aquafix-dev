"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { friendlyError } from "@/lib/db-errors";
import { zonedInputToIso } from "@/lib/inspections/dates";
import { readingsQuery, toReadingRows } from "@/lib/logger-data/readings";
import {
  READINGS_PAGE_SIZE,
  type ChartPoint,
  type LoggerAsset,
  type LoggerReadingRow,
  type PullResult,
  type PullRun,
  type ReadingFilter,
} from "@/lib/logger-data/types";

// Admin → Logger Data. system_admin only here, and again in the database
// (RLS on the logger tables, request_logger_pull's own check).

async function requireSystemAdmin() {
  await requireRole(["system_admin"]);
}

// Most points the chart draws; beyond this it shows the latest ones.
const CHART_LIMIT = 5000;

export async function listLoggerAssets(): Promise<LoggerAsset[]> {
  await requireSystemAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("asset")
    .select("id, name, code, logger_code, logger_type, active, location:location_id(name)")
    .not("logger_code", "is", null)
    .order("name");
  if (error) throw error;
  return (data as unknown as (Omit<LoggerAsset, "location_name"> & { location: { name: string } | null })[]).map(
    ({ location, ...a }) => ({ ...a, location_name: location?.name ?? null }),
  );
}

export async function listReadings(
  filter: ReadingFilter,
  page: number,
  timeZone: string,
): Promise<{ rows: LoggerReadingRow[]; total: number }> {
  await requireSystemAdmin();
  const supabase = await createClient();
  const start = (page - 1) * READINGS_PAGE_SIZE;
  const { data, count, error } = await readingsQuery(supabase, filter, timeZone, true).range(
    start,
    start + READINGS_PAGE_SIZE - 1,
  );
  // Asking for a page past the end (e.g. after narrowing a filter) is not an error.
  if (error && error.code !== "PGRST103") throw error;
  return { rows: toReadingRows(data), total: count ?? 0 };
}

// One asset's readings over the filter's range, oldest first.
export async function listChartPoints(
  filter: ReadingFilter,
  timeZone: string,
): Promise<{ points: ChartPoint[]; unit: string | null; truncated: boolean }> {
  await requireSystemAdmin();
  if (!filter.asset) return { points: [], unit: null, truncated: false };
  const supabase = await createClient();
  const query = () => {
    let q = supabase.from("logger_reading").select("reading_at, value, unit").eq("asset_id", filter.asset);
    if (filter.from) q = q.gte("reading_at", zonedInputToIso(filter.from, timeZone));
    if (filter.to) q = q.lte("reading_at", zonedInputToIso(filter.to, timeZone));
    return q.order("reading_at", { ascending: false });
  };

  // Newest first, one extra to know whether there are more. PostgREST
  // returns at most 1000 rows a request, so page through.
  const rows: { reading_at: string; value: number | string; unit: string | null }[] = [];
  while (rows.length <= CHART_LIMIT) {
    const { data, error } = await query().range(rows.length, Math.min(rows.length + 999, CHART_LIMIT));
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  const truncated = rows.length > CHART_LIMIT;
  const kept = rows.slice(0, CHART_LIMIT);
  return {
    points: kept.map((r) => ({ t: r.reading_at, v: Number(r.value) })).reverse(),
    // The latest unit the logger reported.
    unit: kept.find((r) => r.unit)?.unit ?? null,
    truncated,
  };
}

async function names(ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_user_names", { p_ids: unique });
  for (const row of (data ?? []) as { id: string; name: string }[]) map.set(row.id, row.name);
  return map;
}

export async function listRuns(): Promise<PullRun[]> {
  await requireSystemAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("logger_pull_run_overview")
    .select(
      "id, trigger, logger_type, range_start, range_end, requested_by, asset_ids, created_at, finished_at, " +
        "loggers, pending, succeeded, failed, readings_saved, status",
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(100);
  if (error) throw error;
  const rows = data as unknown as (Omit<PullRun, "requested_by_name" | "asset_count"> & {
    requested_by: string | null;
    asset_ids: string[] | null;
  })[];
  const nameMap = await names(rows.map((r) => r.requested_by));
  return rows.map(({ requested_by, asset_ids, ...r }) => ({
    ...r,
    requested_by_name: requested_by ? (nameMap.get(requested_by) ?? null) : null,
    asset_count: asset_ids ? asset_ids.length : null,
  }));
}

export async function listRunResults(runId: number): Promise<PullResult[]> {
  await requireSystemAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("logger_pull_result")
    .select(
      "id, logger_code, status, attempts, next_attempt_at, finished_at, readings_saved, unit, http_status, error, " +
        "asset:asset_id(name)",
    )
    .eq("run_id", runId)
    .order("logger_code");
  if (error) throw error;
  return (data as unknown as (Omit<PullResult, "asset_name"> & { asset: { name: string } | null })[]).map(
    ({ asset, ...r }) => ({ ...r, asset_name: asset?.name ?? null }),
  );
}

// A manual pull. `from`/`to` are datetime-local values in the app time zone;
// no assets = every active Hydrus logger.
export async function requestPull(input: {
  from: string;
  to: string;
  assetIds: string[];
  timeZone: string;
}): Promise<{ error: string | null; runId?: number }> {
  await requireSystemAdmin();
  if (!input.from || !input.to) return { error: "Choose a start and an end time." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_logger_pull", {
    p_start: zonedInputToIso(input.from, input.timeZone),
    p_end: zonedInputToIso(input.to, input.timeZone),
    p_asset_ids: input.assetIds.length > 0 ? input.assetIds : null,
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/admin/logger-data");
  return { error: null, runId: data as number };
}
