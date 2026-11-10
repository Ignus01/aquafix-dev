"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { friendlyError } from "@/lib/db-errors";
import { gridQuery } from "@/lib/grid/query";
import { nextDay } from "@/lib/grid/params";
import { readingsGrid, runsGrid, type ReadingGridRow, type RunGridRow } from "@/lib/grid/specs/logger";
import type { ChoiceOption, GridParams, GridResult } from "@/lib/grid/types";
import { gridUserOptions, lookupOptions } from "@/lib/grid/user-options";
import { zonedInputToIso } from "@/lib/inspections/dates";
import type { ChartPoint, LoggerAsset, PullResult } from "@/lib/logger-data/types";

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

// One page of logger_reading_grid with the URL's filters and sort.
export async function listReadingGrid(params: GridParams, timeZone: string): Promise<GridResult<ReadingGridRow>> {
  await requireSystemAdmin();
  const supabase = await createClient();
  return gridQuery<ReadingGridRow>(supabase, readingsGrid, params, { timeZone });
}

// One asset's readings over whole days [from, to] in the app time zone
// (either end open), oldest first, for the chart.
export async function listChartPoints(
  assetId: string,
  range: { from: string | null; to: string | null },
  timeZone: string,
): Promise<{ points: ChartPoint[]; unit: string | null; truncated: boolean }> {
  await requireSystemAdmin();
  const supabase = await createClient();
  const query = () => {
    let q = supabase.from("logger_reading").select("reading_at, value, unit").eq("asset_id", assetId);
    if (range.from) q = q.gte("reading_at", zonedInputToIso(`${range.from}T00:00`, timeZone));
    if (range.to) q = q.lt("reading_at", zonedInputToIso(`${nextDay(range.to)}T00:00`, timeZone));
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

// One page of logger_pull_run_grid (was: the latest 100 pulls).
export async function listRunGrid(params: GridParams, timeZone: string): Promise<GridResult<RunGridRow>> {
  await requireSystemAdmin();
  const supabase = await createClient();
  return gridQuery<RunGridRow>(supabase, runsGrid, params, { timeZone });
}

export async function listLoggerUserOptions(): Promise<ChoiceOption[]> {
  await requireSystemAdmin();
  return gridUserOptions(await createClient());
}

// The readings' choice-filter options: logger assets and locations.
export async function listReadingFilterOptions(assets: LoggerAsset[]): Promise<Record<"asset" | "location", ChoiceOption[]>> {
  await requireSystemAdmin();
  const supabase = await createClient();
  const locations = lookupOptions(await supabase.from("location").select("id, name").order("name"));
  return {
    asset: assets.map((a) => ({
      value: a.id,
      label: `${a.name} (${a.logger_code})${a.active ? "" : " · inactive"}`,
    })),
    location: locations,
  };
}

export async function getRun(runId: number): Promise<RunGridRow | null> {
  await requireSystemAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.from("logger_pull_run_grid").select(runsGrid.select!).eq("id", runId).maybeSingle();
  if (error) throw error;
  return data as unknown as RunGridRow | null;
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
