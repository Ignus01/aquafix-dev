"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Pagination, SearchInput, SortableTh, sortRows, usePagination, useSort, type SortValue } from "../data-grid";
import { DownloadIcon } from "../icons";
import { fmt } from "@/lib/dashboard/format";
import { tableHeadCellClass } from "../ui";

export type Column<T> = {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  // Plain value for search and CSV export; omit to leave the column out of both.
  text?: (row: T) => string | number | null;
  // Value to sort by when `text` doesn't sort correctly (formatted dates,
  // ratios…). Columns with neither aren't sortable.
  sortValue?: (row: T) => SortValue;
  className?: string;
};

function csvCell(value: string | number | null | undefined) {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// The back-office grids: search across the text columns, sort by any column,
// 20 rows a page, and Export (Main.ACT_ExportToExcel) as CSV of every
// filtered row, not just the page.
export function DataTable<T>({
  rows,
  columns,
  getKey,
  emptyLabel,
  searchPlaceholder = "Search…",
  exportName,
  actions,
  toolbar,
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
}) {
  const [query, setQuery] = useState("");
  const [sort, toggleSort] = useSort();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? rows.filter((row) => columns.some((c) => c.text && String(c.text(row) ?? "").toLowerCase().includes(q)))
      : rows;
    const col = sort && columns.find((c) => c.key === sort.key);
    const value = col && (col.sortValue ?? col.text);
    return sort && value ? sortRows(matched, value, sort.desc) : matched;
  }, [rows, columns, query, sort]);

  const { pageItems, ...paging } = usePagination(filtered, `${query}|${sort?.key}|${sort?.desc}`);

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

  return (
    <div data-grid className="flex scroll-mt-4 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <SearchInput value={query} onChange={setQuery} placeholder={searchPlaceholder} />
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

      {filtered.length === 0 ? (
        <div className="rounded-card border border-border bg-card px-4 py-10 text-center text-sm text-muted">
          {rows.length === 0 ? (
            emptyLabel
          ) : (
            <>
              Nothing matches “{query.trim()}”.{" "}
              <button
                type="button"
                onClick={() => setQuery("")}
                className="font-semibold text-primary hover:text-primary-hover"
              >
                Clear search
              </button>
            </>
          )}
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
              </thead>
              <tbody>
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
      {rows.length >= 1000 && <p className="text-xs text-muted">Showing the 1,000 most recent rows.</p>}
    </div>
  );
}
