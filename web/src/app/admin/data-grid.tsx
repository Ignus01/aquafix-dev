"use client";

import { useRef, useState } from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SearchIcon,
  XIcon,
} from "./icons";
import { fmt } from "@/lib/dashboard/format";

// Shared building blocks for the back-office grids: search, column sorting
// and paging.

export const PAGE_SIZE = 20;

// ---- Search ---------------------------------------------------------------

export function SearchInput({
  value,
  onChange,
  placeholder = "Search…",
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="flex h-[38px] w-full items-center gap-2 rounded-full border border-border bg-white pr-1.5 pl-3 text-muted transition-colors focus-within:border-primary sm:w-72">
      <SearchIcon className="h-4 w-4 shrink-0" />
      <input
        value={value}
        autoFocus={autoFocus}
        aria-label={placeholder.replace(/…$/, "")}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.preventDefault();
            onChange("");
          }
        }}
        placeholder={placeholder}
        className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-black/[.05] hover:text-ink"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      )}
    </label>
  );
}

// ---- Sorting --------------------------------------------------------------

export type SortValue = string | number | boolean | null | undefined;
export type SortState = { key: string; desc: boolean } | null;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const isEmpty = (v: SortValue) => v === null || v === undefined || v === "";

// Stable sort; blanks go last in either direction, and ties keep the
// server's order.
export function sortRows<T>(rows: T[], value: (row: T) => SortValue, desc: boolean): T[] {
  return [...rows].sort((x, y) => {
    const a = value(x);
    const b = value(y);
    if (isEmpty(a) || isEmpty(b)) return Number(isEmpty(a)) - Number(isEmpty(b));
    const c =
      typeof a === "number" && typeof b === "number"
        ? a - b
        : typeof a === "boolean" && typeof b === "boolean"
          ? Number(a) - Number(b)
          : collator.compare(String(a), String(b));
    return desc ? -c : c;
  });
}

// Clicking a header sorts ascending, then descending, then back to the
// server's order.
export function useSort() {
  const [sort, setSort] = useState<SortState>(null);
  const toggle = (key: string) =>
    setSort((s) => (s?.key !== key ? { key, desc: false } : !s.desc ? { key, desc: true } : null));
  return [sort, toggle] as const;
}

export function SortableTh({
  label,
  sortKey,
  sort,
  onSort,
  className = "",
  title,
}: {
  label: string;
  sortKey: string;
  sort: SortState;
  onSort: (key: string) => void;
  className?: string;
  title?: string;
}) {
  const on = sort?.key === sortKey;
  const Arrow = on && sort.desc ? ArrowDownIcon : ArrowUpIcon;
  return (
    <th
      title={title}
      aria-sort={on ? (sort.desc ? "descending" : "ascending") : undefined}
      className={className}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`group inline-flex items-center gap-1 tracking-wider uppercase transition-colors hover:text-ink ${on ? "text-ink" : ""}`}
      >
        {label}
        <Arrow
          className={`h-3 w-3 shrink-0 transition-opacity ${on ? "" : "opacity-0 group-hover:opacity-40 group-focus-visible:opacity-40"}`}
        />
      </button>
    </th>
  );
}

// ---- Paging ---------------------------------------------------------------

// `resetKey` should change whenever the search, filters or sort change, so
// the grid goes back to page 1 instead of showing an empty or arbitrary page.
export function usePagination<T>(items: T[], resetKey: string) {
  const [state, setState] = useState({ page: 1, resetKey });
  const pageCount = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  // Clamped, so deleting the last row on the last page lands on the new last page.
  const page = Math.min(state.resetKey === resetKey ? state.page : 1, pageCount);
  const start = (page - 1) * PAGE_SIZE;
  return {
    page,
    pageCount,
    total: items.length,
    start,
    pageItems: items.slice(start, start + PAGE_SIZE),
    setPage: (p: number) => setState({ page: p, resetKey }),
  };
}

// First, last, the current page and its neighbours; a gap hiding a single
// page shows that page instead. At most seven slots, so the bar doesn't jump.
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

const navButtonClass =
  "flex h-8 min-w-8 items-center justify-center rounded-control px-2 text-[13px] font-medium text-ink transition-colors hover:bg-black/[.04] disabled:pointer-events-none disabled:opacity-40";

export function Pagination({
  page,
  pageCount,
  total,
  start,
  setPage,
  className = "",
}: Omit<ReturnType<typeof usePagination>, "pageItems"> & { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  if (total === 0) return null;

  function go(p: number) {
    setPage(p);
    // Paging from the bottom of a long grid: bring its top back into view.
    const grid = ref.current?.closest("[data-grid]");
    if (grid && grid.getBoundingClientRect().top < 0) {
      grid.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }

  const end = Math.min(start + PAGE_SIZE, total);

  return (
    <div
      ref={ref}
      className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[13px] text-muted ${className}`}
    >
      <span>
        {pageCount > 1 ? (
          <>
            Showing <span className="font-medium text-ink tabular-nums">{start + 1}–{end}</span> of{" "}
            <span className="font-medium text-ink tabular-nums">{fmt(total)}</span>
          </>
        ) : (
          <>
            <span className="font-medium text-ink tabular-nums">{fmt(total)}</span>{" "}
            {total === 1 ? "row" : "rows"}
          </>
        )}
      </span>

      {pageCount > 1 && (
        <nav aria-label="Pagination" className="flex items-center gap-0.5">
          <button
            type="button"
            className={navButtonClass}
            disabled={page === 1}
            onClick={() => go(page - 1)}
            aria-label="Previous page"
          >
            <ChevronLeftIcon className="h-4 w-4" />
            <span className="hidden pr-1 sm:inline">Prev</span>
          </button>

          <span className="px-2 text-ink tabular-nums sm:hidden">
            {page} / {pageCount}
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
                  onClick={() => go(p)}
                  aria-label={`Page ${p}`}
                  aria-current={p === page ? "page" : undefined}
                  className={`${navButtonClass} tabular-nums ${
                    p === page ? "!bg-primary !text-white hover:!bg-primary" : ""
                  }`}
                >
                  {p}
                </button>
              ),
            )}
          </span>

          <button
            type="button"
            className={navButtonClass}
            disabled={page === pageCount}
            onClick={() => go(page + 1)}
            aria-label="Next page"
          >
            <span className="hidden pl-1 sm:inline">Next</span>
            <ChevronRightIcon className="h-4 w-4" />
          </button>
        </nav>
      )}
    </div>
  );
}
