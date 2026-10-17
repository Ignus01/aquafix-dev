"use client";

import { useDeferredValue, useMemo, useState, type ReactNode } from "react";
import { Pagination, SearchInput, SortableTh, sortRows, usePagination, useSort, type SortValue } from "../data-grid";
import { DownloadIcon } from "../icons";
import { fmt } from "@/lib/dashboard/format";
import { tableHeadCellClass } from "../ui";

// A filter box under the column header, suited to the column's data.
//   text    contains, ignoring case
//   number  =, ≠, >, ≥, <, ≤ against a number
//   date    the same operators against a calendar day
//   select  one of the column's values, picked from a list
export type ColumnFilter = "text" | "number" | "date" | "select";

export type Column<T> = {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  // Plain value for search and CSV export; omit to leave the column out of both.
  text?: (row: T) => string | number | null;
  // Value to sort by when `text` doesn't sort correctly (formatted dates,
  // ratios…). Columns with neither aren't sortable.
  sortValue?: (row: T) => SortValue;
  filter?: ColumnFilter;
  // Value the filter matches when it isn't `text` — a number for "number"
  // (defaults to `sortValue`, then `text`), a `YYYY-MM-DD` day for "date".
  filterValue?: (row: T) => string | number | null;
  className?: string;
};

type Op = "eq" | "ne" | "gt" | "ge" | "lt" | "le";
type FilterState = { op: Op; value: string };

const OPS: { op: Op; symbol: string; number: string; date: string }[] = [
  { op: "eq", symbol: "=", number: "Equal to", date: "On" },
  { op: "ne", symbol: "≠", number: "Not equal to", date: "Not on" },
  { op: "gt", symbol: ">", number: "Greater than", date: "After" },
  { op: "ge", symbol: "≥", number: "Greater than or equal to", date: "On or after" },
  { op: "lt", symbol: "<", number: "Less than", date: "Before" },
  { op: "le", symbol: "≤", number: "Less than or equal to", date: "On or before" },
];

// The select filter's choice for rows with no value.
const BLANK = "\u0000blank";

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compare(op: Op, a: string | number, b: string | number) {
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
}

function filterValueOf<T>(c: Column<T>, row: T): string | number | null | undefined {
  if (c.filterValue) return c.filterValue(row);
  if (c.filter === "number") {
    const v = c.sortValue?.(row) ?? c.text?.(row);
    return typeof v === "boolean" ? Number(v) : v;
  }
  return c.text?.(row);
}

function matches<T>(c: Column<T>, row: T, f: FilterState): boolean {
  const v = filterValueOf(c, row);
  const blank = v === null || v === undefined || v === "";
  switch (c.filter) {
    case "text":
      return String(v ?? "").toLowerCase().includes(f.value.trim().toLowerCase());
    case "select":
      return f.value === BLANK ? blank : !blank && String(v) === f.value;
    case "number": {
      const n = typeof v === "number" ? v : blank ? NaN : Number(v);
      return Number.isFinite(n) && compare(f.op, n, Number(f.value));
    }
    case "date":
      return !blank && compare(f.op, String(v), f.value);
    default:
      return true;
  }
}

// A filter only applies once it has something to match.
function isActive(c: Column<unknown>, f: FilterState | undefined): f is FilterState {
  if (!f || f.value.trim() === "") return false;
  return c.filter !== "number" || Number.isFinite(Number(f.value));
}

function csvCell(value: string | number | null | undefined) {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// The back-office grids: sort by any column, 20 rows a page, and Export
// (Main.ACT_ExportToExcel) as CSV of every filtered row, not just the page.
// Grids whose columns declare a `filter` get a filter box under each header;
// the others get one search box across the text columns.
export function DataTable<T>({
  rows,
  columns,
  getKey,
  emptyLabel,
  searchPlaceholder = "Search…",
  exportName,
  actions,
  toolbar,
  rowLimit = 1000,
}: {
  rows: T[];
  columns: Column<T>[];
  getKey: (row: T) => string;
  emptyLabel: string;
  searchPlaceholder?: string;
  exportName?: string;
  // Trailing cell per row (Edit / Delete…).
  actions?: (row: T) => ReactNode;
  // Extra buttons next to the search box.
  toolbar?: ReactNode;
  // The most rows the server sends, for the "most recent rows" note; null
  // when it sends them all.
  rowLimit?: number | null;
}) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Record<string, FilterState>>({});
  const [sort, toggleSort] = useSort();
  // Typing in a filter stays responsive on grids of tens of thousands of rows.
  const deferredQuery = useDeferredValue(query);
  const deferredFilters = useDeferredValue(filters);

  const perColumn = columns.some((c) => c.filter);

  const selectOptions = useMemo(() => {
    const out: Record<string, { values: string[]; hasBlank: boolean }> = {};
    for (const c of columns) {
      if (c.filter !== "select") continue;
      const values = new Set<string>();
      let hasBlank = false;
      for (const row of rows) {
        const v = filterValueOf(c, row);
        if (v === null || v === undefined || v === "") hasBlank = true;
        else values.add(String(v));
      }
      out[c.key] = { values: [...values].sort(collator.compare), hasBlank };
    }
    return out;
  }, [rows, columns]);

  const active = useMemo(
    () => columns.filter((c) => isActive(c as Column<unknown>, deferredFilters[c.key])),
    [columns, deferredFilters],
  );
  const activeKey = active.map((c) => `${c.key}:${deferredFilters[c.key].op}:${deferredFilters[c.key].value}`).join("|");

  const filtered = useMemo(() => {
    let matched = rows;
    if (perColumn) {
      if (active.length > 0) {
        matched = rows.filter((row) => active.every((c) => matches(c, row, deferredFilters[c.key])));
      }
    } else {
      const q = deferredQuery.trim().toLowerCase();
      if (q) {
        matched = rows.filter((row) =>
          columns.some((c) => c.text && String(c.text(row) ?? "").toLowerCase().includes(q)),
        );
      }
    }
    const col = sort && columns.find((c) => c.key === sort.key);
    const value = col && (col.sortValue ?? col.text);
    return sort && value ? sortRows(matched, value, sort.desc) : matched;
  }, [rows, columns, perColumn, active, deferredFilters, deferredQuery, sort]);

  const { pageItems, ...paging } = usePagination(filtered, `${deferredQuery}|${activeKey}|${sort?.key}|${sort?.desc}`);

  const hasFilters = perColumn ? Object.values(filters).some((f) => f.value !== "") : query.trim() !== "";
  function clearFilters() {
    setFilters({});
    setQuery("");
  }

  function setFilter(c: Column<T>, next: Partial<FilterState>) {
    setFilters((prev) => ({ ...prev, [c.key]: { ...(prev[c.key] ?? { op: "eq", value: "" }), ...next } }));
  }

  function exportCsv() {
    const cols = columns.filter((c) => c.text);
    const lines = [
      cols.map((c) => csvCell(c.label)).join(","),
      ...filtered.map((row) => cols.map((c) => csvCell(c.text!(row))).join(",")),
    ];
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${exportName}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const clearButton = (
    <button type="button" onClick={clearFilters} className="font-semibold text-primary hover:text-primary-hover">
      {perColumn ? "Clear filters" : "Clear search"}
    </button>
  );

  return (
    <div data-grid className="flex scroll-mt-4 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2.5">
        {!perColumn && <SearchInput value={query} onChange={setQuery} placeholder={searchPlaceholder} />}
        {perColumn && hasFilters && <span className="text-sm">{clearButton}</span>}
        <div className="flex-1" />
        {toolbar}
        {exportName && (
          <button
            type="button"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            title={filtered.length > 0 ? `Export ${fmt(filtered.length)} rows as CSV` : undefined}
            className="flex h-[38px] items-center gap-2 rounded-control border border-border bg-white px-3.5 text-sm font-medium text-ink transition-colors hover:bg-black/[.02] disabled:opacity-60"
          >
            <DownloadIcon className="h-4 w-4" />
            Export
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="rounded-card border border-border bg-card px-4 py-10 text-center text-sm text-muted">
          {emptyLabel}
        </div>
      ) : filtered.length === 0 && !perColumn ? (
        <div className="rounded-card border border-border bg-card px-4 py-10 text-center text-sm text-muted">
          Nothing matches “{query.trim()}”. {clearButton}
        </div>
      ) : (
        <div className="overflow-hidden rounded-card border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-table-head">
                  {columns.map((c, i) => {
                    const cls = `${tableHeadCellClass} ${i === 0 ? "!px-4" : ""}`;
                    return c.sortValue || c.text ? (
                      <SortableTh
                        key={c.key}
                        label={c.label}
                        sortKey={c.key}
                        sort={sort}
                        onSort={toggleSort}
                        className={cls}
                      />
                    ) : (
                      <th key={c.key} className={cls}>
                        {c.label}
                      </th>
                    );
                  })}
                  {actions && (
                    <th className={tableHeadCellClass}>
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
                {perColumn && (
                  <tr className="bg-table-head">
                    {columns.map((c, i) => (
                      <th key={c.key} className={`pt-0 pb-2.5 text-left font-normal ${i === 0 ? "pr-3 pl-4" : "px-3"}`}>
                        {c.filter && (
                          <FilterInput
                            type={c.filter}
                            label={c.label}
                            state={filters[c.key]}
                            options={selectOptions[c.key]}
                            onChange={(next) => setFilter(c, next)}
                          />
                        )}
                      </th>
                    ))}
                    {actions && <th />}
                  </tr>
                )}
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr className="border-t border-border">
                    <td colSpan={columns.length + (actions ? 1 : 0)} className="px-4 py-10 text-center text-muted">
                      Nothing matches these filters. {clearButton}
                    </td>
                  </tr>
                )}
                {pageItems.map((row) => (
                  <tr key={getKey(row)} className="border-t border-border align-middle transition-colors hover:bg-row-hover">
                    {columns.map((c, i) => (
                      <td
                        key={c.key}
                        className={`py-2.5 ${i === 0 ? "px-4" : "px-3"} ${c.className ?? "whitespace-nowrap text-ink"}`}
                      >
                        {c.render(row)}
                      </td>
                    ))}
                    {actions && <td className="px-3 py-2.5 text-right whitespace-nowrap">{actions(row)}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination {...paging} className="border-t border-border px-4 py-2" />
        </div>
      )}
      {rowLimit !== null && rows.length >= rowLimit && (
        <p className="text-xs text-muted">Showing the {fmt(rowLimit)} most recent rows.</p>
      )}
    </div>
  );
}

const filterControlClass =
  "h-8 rounded-control border bg-white px-2 text-[13px] text-ink outline-none transition-colors placeholder:text-muted focus:border-primary";

function FilterInput({
  type,
  label,
  state,
  options,
  onChange,
}: {
  type: ColumnFilter;
  label: string;
  state: FilterState | undefined;
  options?: { values: string[]; hasBlank: boolean };
  onChange: (next: Partial<FilterState>) => void;
}) {
  const value = state?.value ?? "";
  const op = state?.op ?? "eq";
  const border = value !== "" ? "border-primary" : "border-border";

  if (type === "select") {
    return (
      <select
        aria-label={`Filter ${label}`}
        value={value}
        onChange={(e) => onChange({ value: e.target.value })}
        className={`${filterControlClass} ${border} w-full min-w-[130px] pr-6 ${value === "" ? "text-muted" : ""}`}
      >
        <option value="">All</option>
        {options?.values.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
        {options?.hasBlank && <option value={BLANK}>(blank)</option>}
      </select>
    );
  }

  if (type === "text") {
    return (
      <input
        type="search"
        aria-label={`Filter ${label}`}
        placeholder="Contains…"
        value={value}
        onChange={(e) => onChange({ value: e.target.value })}
        className={`${filterControlClass} ${border} w-full min-w-[120px]`}
      />
    );
  }

  return (
    <div className={`flex ${type === "date" ? "min-w-[180px]" : "min-w-[120px]"}`}>
      <select
        aria-label={`${label} comparison`}
        title={OPS.find((o) => o.op === op)?.[type]}
        value={op}
        onChange={(e) => onChange({ op: e.target.value as Op })}
        className={`${filterControlClass} ${border} w-11 shrink-0 rounded-r-none border-r-0 px-1 text-center`}
      >
        {OPS.map((o) => (
          <option key={o.op} value={o.op} title={o[type]}>
            {o.symbol}
          </option>
        ))}
      </select>
      <input
        type={type}
        step={type === "number" ? "any" : undefined}
        inputMode={type === "number" ? "decimal" : undefined}
        aria-label={`Filter ${label}`}
        value={value}
        onChange={(e) => onChange({ value: e.target.value })}
        className={`${filterControlClass} ${border} w-full min-w-0 rounded-l-none`}
      />
    </div>
  );
}
