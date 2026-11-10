import {
  BLANK,
  DEFAULT_PAGE_SIZE,
  NUMBER_OPS,
  PAGE_SIZES,
  isSortable,
  type FilterValue,
  type GridField,
  type GridParams,
  type GridSpec,
  type NumberOp,
} from "./types";

// Grid state lives in the URL so a view survives refresh and Back and can be
// shared or exported as is:
//   ?f.name=chem                  text: contains
//   &f.status=new,in_progress     choice: any of ("_blank" = no value)
//   &f.due=2026-10-01..2026-10-31 date range; either end may be open
//   &f.uid=ge:6000                number: eq|ne|gt|ge|lt|le (plain = eq)
//   &sort=-changed&page=2&size=50 "-" = descending
// One parser for the server page, the client grid and the export route.

type SearchParams = Record<string, string | string[] | undefined> | URLSearchParams;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function get(params: SearchParams, key: string): string {
  if (params instanceof URLSearchParams) return params.get(key) ?? "";
  const v = params[key];
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export function parseFilter(field: GridField, raw: string): FilterValue | null {
  const text = raw.trim();
  if (!text || !field.filter) return null;
  switch (field.filter) {
    case "text":
      return { kind: "text", value: text.slice(0, 200) };
    case "choice": {
      const allowed = field.options ? new Set(field.options.map((o) => o.value)) : null;
      const values = [...new Set(text.split(","))].filter(
        (v) => v === BLANK || (allowed ? allowed.has(v) : !field.uuidValues || UUID.test(v)),
      );
      return values.length ? { kind: "choice", values } : null;
    }
    case "date":
    case "datetime": {
      const [from = "", to = ""] = text.split("..");
      const f = YMD.test(from) ? from : null;
      const t = YMD.test(to) ? to : null;
      // A single day without ".." means that day.
      if (!text.includes("..")) return f ? { kind: field.filter, from: f, to: f } : null;
      return f || t ? { kind: field.filter, from: f, to: t } : null;
    }
    case "number": {
      const m = /^(?:(eq|ne|gt|ge|lt|le):)?(-?\d+(?:\.\d+)?)$/.exec(text);
      if (!m) return null;
      return { kind: "number", op: (m[1] as NumberOp) ?? "eq", value: Number(m[2]) };
    }
  }
}

export function formatFilter(value: FilterValue): string {
  switch (value.kind) {
    case "text":
      return value.value;
    case "choice":
      return value.values.join(",");
    case "date":
    case "datetime":
      return value.from && value.from === value.to ? value.from : `${value.from ?? ""}..${value.to ?? ""}`;
    case "number":
      return value.op === "eq" ? String(value.value) : `${value.op}:${value.value}`;
  }
}

export function parseGridParams(params: SearchParams, spec: GridSpec, prefix = ""): GridParams {
  const filters: Record<string, FilterValue> = {};
  for (const field of spec.fields) {
    const value = parseFilter(field, get(params, `${prefix}f.${field.key}`));
    if (value) filters[field.key] = value;
  }

  const rawSort = get(params, `${prefix}sort`);
  const desc = rawSort.startsWith("-");
  const sortField = spec.fields.find((f) => f.key === rawSort.replace(/^-/, ""));
  const sort = sortField && isSortable(sortField) ? { key: sortField.key, desc } : spec.defaultSort;

  const size = Number(get(params, `${prefix}size`));
  const page = Math.floor(Number(get(params, `${prefix}page`)));
  return {
    filters,
    sort,
    page: Number.isFinite(page) && page > 1 ? Math.min(page, 100_000) : 1,
    size: (PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_PAGE_SIZE,
  };
}

// The grid's state written over `base` (other params such as `tab` are kept).
// Defaults are left out so URLs stay short.
export function gridSearchParams(
  base: URLSearchParams,
  next: GridParams,
  spec: GridSpec,
  prefix = "",
): URLSearchParams {
  const out = new URLSearchParams(base);
  for (const key of [...out.keys()]) {
    if (key.startsWith(`${prefix}f.`)) out.delete(key);
  }
  for (const field of spec.fields) {
    const value = next.filters[field.key];
    if (value) out.set(`${prefix}f.${field.key}`, formatFilter(value));
  }
  const isDefaultSort = next.sort.key === spec.defaultSort.key && next.sort.desc === spec.defaultSort.desc;
  if (isDefaultSort) out.delete(`${prefix}sort`);
  else out.set(`${prefix}sort`, `${next.sort.desc ? "-" : ""}${next.sort.key}`);
  if (next.page > 1) out.set(`${prefix}page`, String(next.page));
  else out.delete(`${prefix}page`);
  if (next.size !== DEFAULT_PAGE_SIZE) out.set(`${prefix}size`, String(next.size));
  else out.delete(`${prefix}size`);
  return out;
}

export function hasFilters(params: GridParams) {
  return Object.keys(params.filters).length > 0;
}

export function isNumberOp(op: string): op is NumberOp {
  return (NUMBER_OPS as readonly string[]).includes(op);
}

// The day after `ymd`, for half-open day ranges.
export function nextDay(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}
