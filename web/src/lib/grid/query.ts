import type { SupabaseClient } from "@supabase/supabase-js";
import { zonedInputToIso } from "@/lib/inspections/dates";
import { hasFilters, nextDay } from "./params";
import { BLANK, fieldOf, type FilterValue, type GridParams, type GridResult, type GridSpec } from "./types";

// Server mode: one page of a `<thing>_grid` view plus a total, with the
// filters and sort from the URL. Runs with the caller's session, so RLS on
// the view's base tables is the real gate.

const PG_OPS = { eq: "eq", ne: "neq", gt: "gt", ge: "gte", lt: "lt", le: "lte" } as const;

// Loose on purpose: the views aren't in generated types, and each grid casts
// its rows to its own row type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyQuery = any;

// `\`, `%` and `_` are pattern characters in ilike.
function likePattern(text: string) {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function quoted(v: string) {
  return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function applyFilter(q: AnyQuery, column: string, f: FilterValue, timeZone: string): AnyQuery {
  switch (f.kind) {
    case "text":
      return q.ilike(column, likePattern(f.value));
    case "choice": {
      const values = f.values.filter((v) => v !== BLANK);
      const blank = values.length < f.values.length;
      if (!blank) return q.in(column, values);
      if (values.length === 0) return q.is(column, null);
      return q.or(`${column}.in.(${values.map(quoted).join(",")}),${column}.is.null`);
    }
    case "date":
      if (f.from) q = q.gte(column, f.from);
      if (f.to) q = q.lte(column, f.to);
      return q;
    case "datetime":
      // Whole days in the app's time zone: [from 00:00, the day after `to`).
      if (f.from) q = q.gte(column, zonedInputToIso(`${f.from}T00:00`, timeZone));
      if (f.to) q = q.lt(column, zonedInputToIso(`${nextDay(f.to)}T00:00`, timeZone));
      return q;
    case "number":
      return q.filter(column, PG_OPS[f.op], f.value);
  }
}

export function applyGridFilters(q: AnyQuery, spec: GridSpec, params: GridParams, timeZone: string): AnyQuery {
  for (const field of spec.fields) {
    const f = params.filters[field.key];
    if (f) q = applyFilter(q, fieldOf(field), f, timeZone);
  }
  return q;
}

// The sort, then id as a tie-break so pages never skip or repeat rows. The
// tie-break runs opposite to the sort to match the `(col desc, id)` indexes
// (a backward scan gives `col asc, id desc`). Postgres' default null order
// is kept for the same reason.
export function applyGridSort(q: AnyQuery, spec: GridSpec, params: GridParams): AnyQuery {
  const field = spec.fields.find((f) => f.key === params.sort.key);
  const column = field ? (field.sortField ?? fieldOf(field)) : "id";
  q = q.order(column, { ascending: !params.sort.desc });
  return column === "id" ? q : q.order("id", { ascending: params.sort.desc });
}

export async function gridQuery<T>(
  supabase: SupabaseClient,
  spec: GridSpec,
  params: GridParams,
  options: { timeZone: string; scope?: (q: AnyQuery) => AnyQuery },
): Promise<GridResult<T>> {
  if (!spec.view || !spec.select) throw new Error(`Grid ${spec.id} has no view`);
  // An exact count of a big unfiltered table is the slow part (Logger data
  // timed out on it); for those the planner's estimate is near enough until
  // a filter narrows it. PostgREST counts exactly anyway below max_rows.
  const countIsEstimate = Boolean(spec.estimateCount) && !hasFilters(params);

  const run = (page: number) => {
    let q: AnyQuery = supabase
      .from(spec.view!)
      .select(spec.select!, { count: countIsEstimate ? "estimated" : "exact" });
    if (options.scope) q = options.scope(q);
    q = applyGridSort(applyGridFilters(q, spec, params, options.timeZone), spec, params);
    const start = (page - 1) * params.size;
    return q.range(start, start + params.size - 1) as Promise<{
      data: T[] | null;
      count: number | null;
      error: { code?: string; message: string } | null;
    }>;
  };

  let page = params.page;
  let res = await run(page);
  // A page past the end (a filter narrowed the list, or a stale link):
  // show the last page instead.
  const pastEnd = page > 1 && (res.error?.code === "PGRST103" || (!res.error && res.data?.length === 0));
  if (pastEnd) {
    const first = await run(1);
    if (first.error) throw first.error;
    page = Math.max(1, Math.ceil((first.count ?? 0) / params.size));
    res = page === 1 ? first : await run(page);
  }
  if (res.error) throw res.error;
  const rows = res.data ?? [];
  // An estimate can undershoot what is plainly on screen; and while pages
  // keep coming back full, there may be more, so Next stays available.
  const seen = (page - 1) * params.size + rows.length;
  const total = Math.max(res.count ?? 0, countIsEstimate && rows.length === params.size ? seen + 1 : seen);
  return { rows, total, countIsEstimate, page };
}
