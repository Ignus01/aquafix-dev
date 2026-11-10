import { zonedDay } from "@/lib/inspections/dates";
import { BLANK, type FilterValue, type GridParams, type GridResult, type GridSpec } from "./types";

// Client mode: the same filter, sort and paging semantics as query.ts, in
// JS, for small tables that are loaded whole.

// A list (a user's roles) matches a choice filter when any item does.
export type CellValue = string | number | boolean | readonly string[] | null | undefined;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function isBlank(v: CellValue) {
  return v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
}

function compareNumber(op: string, a: number, b: number) {
  switch (op) {
    case "eq":
      return a === b;
    case "ne":
      return a !== b;
    case "gt":
      return a > b;
    case "ge":
      return a >= b;
    case "lt":
      return a < b;
    case "le":
      return a <= b;
  }
  return false;
}

export function matchesFilter(v: CellValue, f: FilterValue, day: (iso: string) => string): boolean {
  switch (f.kind) {
    case "text":
      return String(v ?? "").toLowerCase().includes(f.value.toLowerCase());
    case "choice":
      return f.values.some((c) =>
        c === BLANK ? isBlank(v) : Array.isArray(v) ? v.includes(c) : !isBlank(v) && String(v) === c,
      );
    case "date":
    case "datetime": {
      if (isBlank(v)) return false;
      const d = f.kind === "datetime" ? day(String(v)) : String(v).slice(0, 10);
      return (!f.from || d >= f.from) && (!f.to || d <= f.to);
    }
    case "number": {
      if (isBlank(v)) return false;
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) && compareNumber(f.op, n, f.value);
    }
  }
}

function compareValues(a: CellValue, b: CellValue): number {
  // Blanks last, whichever way the column is sorted (as Postgres NULLS LAST
  // ascending; descending keeps them last too, which reads better here).
  if (isBlank(a) || isBlank(b)) return isBlank(a) === isBlank(b) ? 0 : isBlank(a) ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return collator.compare(String(a), String(b));
}

export function clientGrid<T>(
  rows: T[],
  spec: GridSpec,
  params: GridParams,
  value: (row: T, key: string) => CellValue,
  timeZone: string,
  // A column may sort on something other than what it filters on (a lookup
  // filtered by id, sorted by name).
  sortValue: (row: T, key: string) => CellValue = value,
): GridResult<T> & { filtered: T[] } {
  const day = zonedDay(timeZone);
  const active = Object.entries(params.filters);
  let filtered = active.length
    ? rows.filter((row) => active.every(([key, f]) => matchesFilter(value(row, key), f, day)))
    : rows;

  const { key, desc } = params.sort;
  if (spec.fields.some((f) => f.key === key)) {
    filtered = filtered
      .map((row, i) => ({ row, i, v: sortValue(row, key) }))
      .sort((a, b) => {
        const blank = isBlank(a.v) || isBlank(b.v);
        const c = compareValues(a.v, b.v);
        return (blank ? c : desc ? -c : c) || a.i - b.i;
      })
      .map((x) => x.row);
  }

  const total = filtered.length;
  const lastPage = Math.max(1, Math.ceil(total / params.size));
  const page = Math.min(params.page, lastPage);
  const start = (page - 1) * params.size;
  return {
    rows: filtered.slice(start, start + params.size),
    filtered,
    total,
    countIsEstimate: false,
    page,
  };
}
