import "server-only";
import { createClient } from "@/lib/supabase/server";
import { zonedInputToIso } from "@/lib/inspections/dates";
import { READING_SORT_KEYS, type LoggerReadingRow, type ReadingFilter, type ReadingSortKey } from "./types";

// The readings query shared by the grid and the CSV export, so both show
// exactly the same rows in the same order.

type Params = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const DATETIME_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseReadingFilter(params: Params): ReadingFilter {
  const sort = one(params.sort) as ReadingSortKey;
  const from = one(params.from);
  const to = one(params.to);
  const asset = one(params.asset);
  return {
    asset: UUID.test(asset) ? asset : "",
    from: DATETIME_LOCAL.test(from) ? from : "",
    to: DATETIME_LOCAL.test(to) ? to : "",
    sort: READING_SORT_KEYS.includes(sort) ? sort : null,
    desc: one(params.dir) === "desc",
  };
}

export const READING_SELECT =
  "id, reading_at, value, unit, logger_type, logger_code, pulled_at, asset_id, " +
  "asset:asset_id(name, code, location:location_id(name))";

type RawReading = Omit<LoggerReadingRow, "asset_name" | "asset_code" | "location_name" | "value"> & {
  value: number | string;
  asset: { name: string; code: string; location: { name: string } | null } | null;
};

export function toReadingRows(data: unknown): LoggerReadingRow[] {
  return ((data ?? []) as RawReading[]).map(({ asset, ...r }) => ({
    ...r,
    value: Number(r.value),
    asset_name: asset?.name ?? "—",
    asset_code: asset?.code ?? "",
    location_name: asset?.location?.name ?? null,
  }));
}

// Newest reading first unless a column is sorted; id breaks ties so paging
// is stable. Returns the unexecuted query, for the caller to add a range.
export function readingsQuery(
  supabase: Awaited<ReturnType<typeof createClient>>,
  filter: ReadingFilter,
  timeZone: string,
  withCount = false,
) {
  let q = supabase
    .from("logger_reading")
    .select(READING_SELECT, withCount ? { count: "exact" } : undefined);
  if (filter.asset) q = q.eq("asset_id", filter.asset);
  if (filter.from) q = q.gte("reading_at", zonedInputToIso(filter.from, timeZone));
  if (filter.to) q = q.lte("reading_at", zonedInputToIso(filter.to, timeZone));
  const desc = filter.sort ? filter.desc : true;
  return q
    .order(filter.sort ?? "reading_at", { ascending: !desc, nullsFirst: false })
    .order("id", { ascending: !desc });
}
