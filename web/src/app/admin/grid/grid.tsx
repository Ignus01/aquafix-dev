"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { fmt } from "@/lib/dashboard/format";
import { clientGrid, type CellValue } from "@/lib/grid/client-filter";
import { gridSearchParams, hasFilters } from "@/lib/grid/params";
import {
  PAGE_SIZES,
  isSortable,
  type ChoiceOption,
  type FilterValue,
  type GridField,
  type GridParams,
  type GridResult,
  type GridSpec,
} from "@/lib/grid/types";
import { todayInZone } from "@/lib/inspections/dates";
import { ArrowDownIcon, ArrowUpIcon, ChevronLeftIcon, ChevronRightIcon, DownloadIcon, SlidersIcon, XIcon } from "../icons";
import { tableHeadCellClass } from "../ui";
import type { GridColumn } from "./columns";
import { ChoiceFilter, DateFilter, NumberFilter, TextFilter, choiceSummary, dateSummary } from "./filters";
import { Popover } from "./popover";
import { RowMenu, type RowMenuItem } from "./row-menu";
import { useGridParams } from "./use-grid-params";

// The one back-office grid (docs/grid-redesign-plan.md): a filter in every
// column, the record ID first (a link to the record, with a ⋯ menu beside
// it, sticky when scrolling sideways), Changed and Changed by last, and its
// state in the URL. Server mode shows one page fetched by the server; client
// mode filters a small, fully loaded table in the browser. Both look the same.

type CommonProps<T> = {
  spec: GridSpec;
  columns: GridColumn<T>[];
  getKey: (row: T) => string;
  title: string;
  timeZone: string;
  // The ID link: the edit page for editors, the view page otherwise.
  rowHref?: (row: T) => string;
  // Instead of rowHref: the ID opens the record in place (a drawer or
  // dialog), for small lookup tables that keep one (D1).
  onRowOpen?: (row: T) => void;
  // Checkboxes in the ID column (bulk actions, e.g. approving invoices). The
  // header box selects every selectable row the filters leave.
  selection?: {
    selected: ReadonlySet<string>;
    onChange: (next: Set<string>) => void;
    isSelectable: (row: T) => boolean;
  };
  // How the row is named in its menu's label ("instruction 6012").
  rowLabel: (row: T) => string;
  rowMenu?: (row: T) => RowMenuItem[];
  // Choice options from lookup tables (users, assets…), by column key.
  options?: Record<string, ChoiceOption[]>;
  primaryAction?: ReactNode;
  emptyLabel: string;
  // Only when a page shows two grids.
  prefix?: string;
  // Rows Export writes are the filtered rows, not just the page.
  exportable?: boolean;
};

type GridProps<T> = CommonProps<T> &
  ({ mode: "server"; result: GridResult<T>; params: GridParams } | { mode: "client"; rows: T[] });

const storage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Private window or blocked storage: the choice just isn't remembered.
    }
  },
};

function checkLayout(spec: GridSpec, columns: GridColumn<unknown>[]) {
  if (process.env.NODE_ENV === "production") return;
  const keys = spec.fields.map((f) => f.key);
  const missing = keys.filter((k) => !columns.some((c) => c.key === k));
  if (missing.length) throw new Error(`Grid ${spec.id}: no column renderer for ${missing.join(", ")}`);
  const tail = keys.slice(-2).join(",");
  if (tail !== "changed,changed_by" && !spec.changedException) {
    throw new Error(`Grid ${spec.id}: Changed and Changed by must be the last two columns`);
  }
}

const OP_SYMBOL = { eq: "=", ne: "≠", gt: ">", ge: "≥", lt: "<", le: "≤" } as const;

function filterSummary(field: GridField, value: FilterValue, options: ChoiceOption[], today: string) {
  switch (value.kind) {
    case "text":
      return `contains “${value.value}”`;
    case "choice":
      return choiceSummary(value.values, options);
    case "date":
    case "datetime":
      return dateSummary(value.from, value.to, today);
    case "number":
      return `${OP_SYMBOL[value.op]} ${value.value}`;
  }
}

function pageList(page: number, count: number): (number | "gap")[] {
  const shown = new Set([1, count, page - 1, page, page + 1]);
  if (page <= 4) for (let p = 1; p <= 5; p++) shown.add(p);
  if (page >= count - 3) for (let p = count - 4; p <= count; p++) shown.add(p);
  const pages = [...shown].filter((p) => p >= 1 && p <= count).sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  pages.forEach((p, i) => {
    const prev = pages[i - 1];
    if (prev !== undefined && p - prev === 2) out.push(prev + 1);
    else if (prev !== undefined && p - prev > 2) out.push("gap");
    out.push(p);
  });
  return out;
}

function csvCell(value: CellValue) {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const toolbarButtonClass =
  "flex h-[38px] items-center gap-2 rounded-control border border-border bg-white px-3.5 text-sm font-medium text-ink transition-colors hover:bg-black/[.02] disabled:opacity-60";
const navButtonClass =
  "flex h-8 min-w-8 items-center justify-center rounded-control px-2 text-[13px] font-medium text-ink transition-colors hover:bg-black/[.04] disabled:pointer-events-none disabled:opacity-40";

export function Grid<T>(props: GridProps<T>) {
  const {
    spec,
    columns,
    getKey,
    title,
    timeZone,
    rowHref,
    onRowOpen,
    selection,
    rowLabel,
    rowMenu,
    options = {},
    primaryAction,
    emptyLabel,
    prefix = "",
    exportable = true,
  } = props;
  checkLayout(spec, columns as GridColumn<unknown>[]);

  const { params, navigate, isPending, searchParams } = useGridParams(
    spec,
    props.mode,
    prefix,
    props.mode === "server" ? props.params : undefined,
  );

  // Two quick filter changes must both land, even before the server has
  // answered the first: build each change on the last one requested.
  const latest = useRef(params);
  useEffect(() => {
    latest.current = params;
  }, [params]);
  function update(change: Partial<GridParams>) {
    const next = { ...latest.current, page: 1, ...change };
    latest.current = next;
    navigate(next);
  }
  function setFilter(key: string, value: FilterValue | null) {
    const filters = { ...latest.current.filters };
    if (value) filters[key] = value;
    else delete filters[key];
    update({ filters });
  }

  const byKey = useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns]);
  const rows = props.mode === "client" ? props.rows : null;
  const clientResult = useMemo(
    () =>
      rows
        ? clientGrid(
            rows,
            spec,
            params,
            (row, key) => byKey.get(key)?.value?.(row),
            timeZone,
            (row, key) => {
              const col = byKey.get(key);
              return (col?.sortValue ?? col?.value)?.(row);
            },
          )
        : null,
    [rows, spec, params, byKey, timeZone],
  );
  const result: GridResult<T> = props.mode === "server" ? props.result : clientResult!;

  // Remembered per grid (D6): applied once, when the URL doesn't say.
  const sizeKey = `grid:${spec.id}:size`;
  useEffect(() => {
    if (searchParams.get(`${prefix}size`)) return;
    const stored = Number(storage.get(sizeKey));
    if ((PAGE_SIZES as readonly number[]).includes(stored) && stored !== latest.current.size) {
      update({ size: stored });
    }
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show / hide columns (D4), remembered per grid.
  const hiddenKey = `grid:${spec.id}:hidden`;
  const defaultHidden = useMemo(() => spec.fields.filter((f) => f.defaultHidden).map((f) => f.key), [spec]);
  const [hidden, setHidden] = useState<string[]>(defaultHidden);
  useEffect(() => {
    const stored = storage.get(hiddenKey);
    if (stored === null) return;
    try {
      const keys = JSON.parse(stored);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is only readable after hydration
      if (Array.isArray(keys)) setHidden(keys.filter((k) => typeof k === "string"));
    } catch {
      // Ignore a corrupt entry.
    }
  }, [hiddenKey]);
  function toggleColumn(key: string) {
    const next = hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key];
    setHidden(next);
    storage.set(hiddenKey, JSON.stringify(next));
  }
  const fields = spec.fields.filter((f, i) => i === 0 || !f.hideable || !hidden.includes(f.key));

  const today = todayInZone(timeZone);
  const filtered = hasFilters(params);
  const pageCount = Math.max(1, Math.ceil(result.total / params.size));
  const page = Math.min(result.page, pageCount);
  const start = (page - 1) * params.size;
  const optionsFor = (f: GridField) => f.options ?? options[f.key] ?? [];

  const tableTop = useRef<HTMLDivElement>(null);
  function goToPage(p: number) {
    update({ page: p });
    tableTop.current?.scrollTo({ top: 0 });
    const grid = tableTop.current?.closest("[data-grid]");
    if (grid && grid.getBoundingClientRect().top < 0) grid.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function onSort(f: GridField) {
    const desc = params.sort.key === f.key ? !params.sort.desc : false;
    update({ sort: { key: f.key, desc } });
  }

  const [columnsOpen, setColumnsOpen] = useState(false);
  const columnsButton = useRef<HTMLButtonElement>(null);
  const hideable = spec.fields.filter((f) => f.hideable);

  function exportHref() {
    const qs = gridSearchParams(new URLSearchParams(), { ...params, page: 1 }, spec, "");
    qs.delete("size");
    const s = qs.toString();
    return `/admin/export/${spec.id}${s ? `?${s}` : ""}`;
  }

  function exportClient() {
    if (!clientResult) return;
    const cols = spec.fields.filter((f) => f.exportField !== false);
    const label = (f: GridField, v: CellValue): CellValue => {
      if (Array.isArray(v)) return v.map((x) => label(f, x)).join(", ");
      const o = optionsFor(f).find((x) => x.value === String(v));
      return o ? o.label : v;
    };
    const lines = [
      cols.map((f) => csvCell(f.label)).join(","),
      ...clientResult.filtered.map((row) =>
        cols.map((f) => csvCell(label(f, byKey.get(f.key)?.value?.(row)))).join(","),
      ),
    ];
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${spec.id}-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Selection covers every row the filters leave (client mode), or the page.
  const candidates = clientResult ? clientResult.filtered : result.rows;
  const selectable = selection ? candidates.filter(selection.isSelectable) : [];
  const allSelected = selectable.length > 0 && selectable.every((r) => selection!.selected.has(getKey(r)));
  function toggleAll() {
    if (!selection) return;
    const next = new Set(selection.selected);
    for (const r of selectable) {
      if (allSelected) next.delete(getKey(r));
      else next.add(getKey(r));
    }
    selection.onChange(next);
  }
  function toggleOne(key: string) {
    if (!selection) return;
    const next = new Set(selection.selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selection.onChange(next);
  }

  const countLabel = `${result.countIsEstimate ? "about " : ""}${fmt(result.total)}`;
  const activeFilters = spec.fields.filter((f) => params.filters[f.key]);
  const isEmpty = result.total === 0 && !filtered;

  const clearAll = (
    <button type="button" onClick={() => update({ filters: {} })} className="font-semibold text-primary hover:text-primary-hover">
      Clear all
    </button>
  );

  return (
    <div data-grid className="flex scroll-mt-4 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-1 text-sm font-semibold text-ink">
          {title}
          <span className="font-normal text-muted"> · {countLabel}</span>
        </h2>
        {activeFilters.map((f) => (
          <span
            key={f.key}
            className="flex h-7 items-center gap-1 rounded-full border border-primary/30 bg-primary/5 pr-1 pl-2.5 text-xs text-ink"
          >
            <span className="font-medium">{f.label}</span>
            <span className="max-w-[200px] truncate text-muted">
              {filterSummary(f, params.filters[f.key], optionsFor(f), today)}
            </span>
            <button
              type="button"
              aria-label={`Clear ${f.label} filter`}
              onClick={() => setFilter(f.key, null)}
              className="rounded-full p-0.5 text-muted hover:bg-black/[.06] hover:text-ink"
            >
              <XIcon className="h-3 w-3" />
            </button>
          </span>
        ))}
        {activeFilters.length > 1 && <span className="text-xs">{clearAll}</span>}
        <div className="flex-1" />
        {hideable.length > 0 && (
          <>
            <button
              ref={columnsButton}
              type="button"
              aria-haspopup="dialog"
              aria-expanded={columnsOpen}
              onClick={() => setColumnsOpen((o) => !o)}
              className={toolbarButtonClass}
            >
              <SlidersIcon className="h-4 w-4" />
              Columns
            </button>
            <Popover
              anchor={columnsButton}
              open={columnsOpen}
              onClose={() => setColumnsOpen(false)}
              align="end"
              role="dialog"
              label="Show columns"
              className="w-56 p-2"
            >
              {hideable.map((f) => (
                <label
                  key={f.key}
                  className="flex cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-[13px] text-ink hover:bg-row-hover"
                >
                  <input
                    type="checkbox"
                    checked={!hidden.includes(f.key)}
                    onChange={() => toggleColumn(f.key)}
                    className="h-3.5 w-3.5 accent-[var(--color-primary)]"
                  />
                  {f.label}
                </label>
              ))}
            </Popover>
          </>
        )}
        {exportable &&
          (props.mode === "server" ? (
            <a
              href={exportHref()}
              aria-disabled={result.total === 0}
              title={`Export ${countLabel} rows as CSV`}
              className={`${toolbarButtonClass} ${result.total === 0 ? "pointer-events-none opacity-60" : ""}`}
            >
              <DownloadIcon className="h-4 w-4" />
              Export
            </a>
          ) : (
            <button type="button" onClick={exportClient} disabled={result.total === 0} className={toolbarButtonClass}>
              <DownloadIcon className="h-4 w-4" />
              Export
            </button>
          ))}
        {primaryAction}
      </div>

      {isEmpty ? (
        <div className="rounded-card border border-border bg-card px-4 py-12 text-center text-sm text-muted">{emptyLabel}</div>
      ) : (
        <div className="relative overflow-hidden rounded-card border border-border bg-card">
          {isPending && (
            <div className="absolute inset-x-0 top-0 z-30 h-0.5 overflow-hidden bg-primary/15" role="progressbar" aria-label="Loading">
              <div className="h-full w-1/3 animate-[grid-progress_1.1s_ease-in-out_infinite] bg-primary" />
            </div>
          )}
          <div ref={tableTop} className="max-h-[calc(100dvh-240px)] min-h-[220px] overflow-auto overscroll-x-contain">
            <table className="grid-table w-full border-separate border-spacing-0 text-sm" aria-busy={isPending}>
              <thead className="sticky top-0 z-20">
                <tr>
                  {fields.map((f, i) => {
                    const sorted = params.sort.key === f.key;
                    const sticky = i === 0 ? "sticky left-0 z-10 !pl-4" : "";
                    return (
                      <th
                        key={f.key}
                        scope="col"
                        aria-sort={sorted ? (params.sort.desc ? "descending" : "ascending") : undefined}
                        className={`${tableHeadCellClass} bg-table-head ${sticky} ${byKey.get(f.key)?.align === "right" ? "text-right" : ""}`}
                      >
                        {i === 0 && selection && (
                          <input
                            type="checkbox"
                            aria-label="Select all rows shown"
                            checked={allSelected}
                            disabled={selectable.length === 0}
                            onChange={toggleAll}
                            className="mr-2.5 h-3.5 w-3.5 align-middle accent-[var(--color-primary)]"
                          />
                        )}
                        {isSortable(f) ? (
                          <button
                            type="button"
                            onClick={() => onSort(f)}
                            className={`inline-flex items-center gap-1 uppercase hover:text-ink ${sorted ? "text-ink" : ""}`}
                          >
                            {f.label}
                            {sorted ? (
                              params.sort.desc ? (
                                <ArrowDownIcon className="h-3 w-3" />
                              ) : (
                                <ArrowUpIcon className="h-3 w-3" />
                              )
                            ) : (
                              <span className="h-3 w-3" aria-hidden="true" />
                            )}
                          </button>
                        ) : (
                          f.label
                        )}
                      </th>
                    );
                  })}
                </tr>
                <tr>
                  {fields.map((f, i) => (
                    <th
                      key={f.key}
                      className={`border-b border-border bg-table-head px-3 pt-0 pb-2.5 text-left font-normal ${
                        i === 0 ? "sticky left-0 z-10 !pl-4" : ""
                      }`}
                    >
                      {f.filter === "text" && (
                        <TextFilter field={f} value={params.filters[f.key]} onChange={(v) => setFilter(f.key, v)} />
                      )}
                      {f.filter === "number" && (
                        <NumberFilter field={f} value={params.filters[f.key]} onChange={(v) => setFilter(f.key, v)} />
                      )}
                      {f.filter === "choice" && (
                        <ChoiceFilter
                          field={f}
                          value={params.filters[f.key]}
                          options={optionsFor(f)}
                          onChange={(v) => setFilter(f.key, v)}
                        />
                      )}
                      {(f.filter === "date" || f.filter === "datetime") && (
                        <DateFilter
                          field={f}
                          value={params.filters[f.key]}
                          timeZone={timeZone}
                          onChange={(v) => setFilter(f.key, v)}
                        />
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className={`transition-opacity ${isPending ? "opacity-50" : ""}`}>
                {result.rows.length === 0 && (
                  <tr>
                    <td colSpan={fields.length} className="px-4 py-12 text-center text-muted">
                      No rows match these filters. {clearAll}
                    </td>
                  </tr>
                )}
                {result.rows.map((row) => (
                  <tr key={getKey(row)}>
                    {fields.map((f, i) => {
                      const col = byKey.get(f.key)!;
                      // Cell styling is in globals.css (.grid-table): it would
                      // otherwise repeat on every cell of every row.
                      const cls = [col.align === "right" && "num", col.className].filter(Boolean).join(" ") || undefined;
                      if (i === 0) {
                        return (
                          <td key={f.key} className={cls}>
                            <span className="grid-id-cell">
                              {selection && (
                                <input
                                  type="checkbox"
                                  aria-label={`Select ${rowLabel(row)}`}
                                  checked={selection.selected.has(getKey(row))}
                                  disabled={!selection.isSelectable(row)}
                                  onChange={() => toggleOne(getKey(row))}
                                  className={`mr-1 h-3.5 w-3.5 accent-[var(--color-primary)] ${
                                    selection.isSelectable(row) ? "" : "invisible"
                                  }`}
                                />
                              )}
                              {rowHref ? (
                                <Link href={rowHref(row)} className="grid-id">
                                  {col.render(row)}
                                </Link>
                              ) : onRowOpen ? (
                                <button type="button" onClick={() => onRowOpen(row)} className="grid-id text-left">
                                  {col.render(row)}
                                </button>
                              ) : (
                                <span className="font-semibold text-ink">{col.render(row)}</span>
                              )}
                              {rowMenu && <RowMenu label={rowLabel(row)} items={rowMenu(row)} />}
                            </span>
                          </td>
                        );
                      }
                      return (
                        <td key={f.key} className={cls}>
                          {col.render(row)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 text-[13px] text-muted">
            <span className="flex items-center gap-3">
              <span>
                {result.total === 0 ? (
                  "0 rows"
                ) : (
                  <>
                    <span className="font-medium text-ink tabular-nums">
                      {fmt(start + 1)}–{fmt(start + result.rows.length)}
                    </span>{" "}
                    of <span className="font-medium text-ink tabular-nums">{countLabel}</span>
                  </>
                )}
              </span>
              <label className="flex items-center gap-1.5">
                <span className="sr-only sm:not-sr-only">Rows</span>
                <select
                  aria-label="Rows per page"
                  value={params.size}
                  onChange={(e) => {
                    const size = Number(e.target.value);
                    storage.set(sizeKey, String(size));
                    update({ size });
                  }}
                  className="h-7 rounded-control border border-border bg-white px-1.5 text-[13px] text-ink outline-none focus:border-primary"
                >
                  {PAGE_SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            </span>
            {pageCount > 1 && (
              <nav aria-label="Pagination" className="flex items-center gap-0.5">
                <button
                  type="button"
                  className={navButtonClass}
                  disabled={page === 1}
                  onClick={() => goToPage(page - 1)}
                  aria-label="Previous page"
                >
                  <ChevronLeftIcon className="h-4 w-4" />
                  <span className="hidden pr-1 sm:inline">Prev</span>
                </button>
                <span className="px-2 text-ink tabular-nums sm:hidden">
                  {page} / {fmt(pageCount)}
                </span>
                <span className="hidden items-center gap-0.5 sm:flex">
                  {pageList(page, pageCount).map((p, i) =>
                    p === "gap" ? (
                      <span key={`gap-${i}`} className="w-6 text-center" aria-hidden="true">
                        …
                      </span>
                    ) : (
                      <button
                        key={p}
                        type="button"
                        onClick={() => goToPage(p)}
                        aria-label={`Page ${p}`}
                        aria-current={p === page ? "page" : undefined}
                        className={`${navButtonClass} tabular-nums ${p === page ? "!bg-primary !text-white hover:!bg-primary" : ""}`}
                      >
                        {fmt(p)}
                      </button>
                    ),
                  )}
                </span>
                <button
                  type="button"
                  className={navButtonClass}
                  disabled={page === pageCount}
                  onClick={() => goToPage(page + 1)}
                  aria-label="Next page"
                >
                  <span className="hidden pl-1 sm:inline">Next</span>
                  <ChevronRightIcon className="h-4 w-4" />
                </button>
              </nav>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
