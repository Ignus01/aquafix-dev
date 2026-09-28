"use client";

import { useMemo, useState, type ReactNode } from "react";
import { DownloadIcon, SearchIcon } from "../icons";
import { tableHeadCellClass } from "../ui";

export type Column<T> = {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  // Plain value for search and CSV export; omit to leave the column out of both.
  text?: (row: T) => string | number | null;
  className?: string;
};

function csvCell(value: string | number | null | undefined) {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// The back-office grids: search across the text columns, and Export
// (Main.ACT_ExportToExcel) as CSV of the filtered rows.
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      columns.some((c) => c.text && String(c.text(row) ?? "").toLowerCase().includes(q)),
    );
  }, [rows, columns, query]);

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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="flex h-[38px] w-full items-center gap-2 rounded-full border border-border bg-white px-3 text-muted sm:w-72">
          <SearchIcon className="h-4 w-4 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted"
          />
        </label>
        <div className="flex-1" />
        {toolbar}
        {exportName && (
          <button
            type="button"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="flex h-[38px] items-center gap-2 rounded-control border border-border bg-white px-3.5 text-sm font-medium text-ink transition-colors hover:bg-black/[.02] disabled:opacity-60"
          >
            <DownloadIcon className="h-4 w-4" />
            Export
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-card border border-border bg-card px-4 py-10 text-center text-sm text-muted">
          {rows.length === 0 ? emptyLabel : "Nothing matches your search."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-card border border-border bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-table-head">
                {columns.map((c, i) => (
                  <th key={c.key} className={`${tableHeadCellClass} ${i === 0 ? "!px-4" : ""}`}>
                    {c.label}
                  </th>
                ))}
                {actions && <th className={tableHeadCellClass} />}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
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
      )}
      {rows.length >= 1000 && <p className="text-xs text-muted">Showing the 1,000 most recent rows.</p>}
    </div>
  );
}
