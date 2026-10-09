"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/incidents/format";
import {
  READINGS_PAGE_SIZE,
  type ChartPoint,
  type LoggerAsset,
  type LoggerReadingRow,
  type ReadingFilter,
  type ReadingSortKey,
} from "@/lib/logger-data/types";
import { Pagination, SortableTh } from "../data-grid";
import { DownloadIcon } from "../icons";
import { inputClass, primaryButtonClass, secondaryButtonClass, sectionHeadingClass, tableHeadCellClass } from "../ui";
import { LineChart } from "./line-chart";

// Every stored reading, filtered by asset and time and paged on the server
// (there are far too many to load at once). Sorting and paging live in the
// URL so a view can be shared or exported as is.

function query(filter: ReadingFilter, page = 1) {
  const p = new URLSearchParams({ tab: "data" });
  if (filter.asset) p.set("asset", filter.asset);
  if (filter.from) p.set("from", filter.from);
  if (filter.to) p.set("to", filter.to);
  if (filter.sort) {
    p.set("sort", filter.sort);
    p.set("dir", filter.desc ? "desc" : "asc");
  }
  if (page > 1) p.set("page", String(page));
  return p;
}

const formatValue = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 6 });

export function ReadingsView({
  assets,
  filter,
  rows,
  total,
  page,
  chart,
  timeZone,
}: {
  assets: LoggerAsset[];
  filter: ReadingFilter;
  rows: LoggerReadingRow[];
  total: number;
  page: number;
  chart: { points: ChartPoint[]; unit: string | null; truncated: boolean } | null;
  timeZone: string;
}) {
  const router = useRouter();
  const go = (next: ReadingFilter, nextPage = 1) => router.push(`/admin/logger-data?${query(next, nextPage)}`);

  // Ascending, then descending, then back to newest first.
  function onSort(key: string) {
    const k = key as ReadingSortKey;
    if (filter.sort !== k) go({ ...filter, sort: k, desc: false });
    else if (!filter.desc) go({ ...filter, desc: true });
    else go({ ...filter, sort: null, desc: false });
  }
  const sort = filter.sort ? { key: filter.sort, desc: filter.desc } : null;

  const pageCount = Math.max(1, Math.ceil(total / READINGS_PAGE_SIZE));
  const exportParams = query(filter);
  exportParams.delete("tab");
  const selected = assets.find((a) => a.id === filter.asset);
  const filtered = Boolean(filter.asset || filter.from || filter.to);

  return (
    <div className="flex flex-col gap-6">
      <form method="get" action="/admin/logger-data" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="tab" value="data" />
        {filter.sort && (
          <>
            <input type="hidden" name="sort" value={filter.sort} />
            <input type="hidden" name="dir" value={filter.desc ? "desc" : "asc"} />
          </>
        )}
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          Asset
          <select name="asset" defaultValue={filter.asset} className={`${inputClass} min-w-64`}>
            <option value="">All assets</option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.logger_code}){a.active ? "" : " · inactive"}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          From
          <input type="datetime-local" name="from" defaultValue={filter.from} className={`${inputClass} !w-auto`} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          To
          <input type="datetime-local" name="to" defaultValue={filter.to} className={`${inputClass} !w-auto`} />
        </label>
        <button type="submit" className={primaryButtonClass}>
          Filter
        </button>
        {filtered && (
          <Link href="/admin/logger-data?tab=data" className={`${secondaryButtonClass} flex items-center`}>
            Clear
          </Link>
        )}
        <a
          href={`/admin/logger-data/export?${exportParams}`}
          download
          aria-disabled={total === 0}
          className={`${secondaryButtonClass} ml-auto flex items-center gap-2 ${total === 0 ? "pointer-events-none opacity-60" : ""}`}
        >
          <DownloadIcon className="h-4 w-4" />
          Export CSV
        </a>
      </form>

      {chart && selected && (
        <section className="rounded-card border border-border bg-card">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-5 py-4 md:px-6">
            <h2 className={sectionHeadingClass}>
              {selected.name} · {selected.logger_code}
              {chart.unit && <span className="normal-case"> · {chart.unit}</span>}
            </h2>
            {chart.truncated && (
              <span className="text-xs text-muted">
                Showing the latest {chart.points.length.toLocaleString("en-US")} readings. Narrow the dates to see
                earlier ones.
              </span>
            )}
          </div>
          <div className="px-5 py-5 md:px-6">
            {chart.points.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">No readings for this asset in this period.</p>
            ) : (
              <LineChart
                points={chart.points}
                unit={chart.unit}
                timeZone={timeZone}
                ariaLabel={`Readings for ${selected.name}`}
              />
            )}
          </div>
        </section>
      )}
      {!filter.asset && total > 0 && (
        <p className="-mt-3 text-xs text-muted">Choose an asset to see its readings as a chart.</p>
      )}

      <section data-grid className="rounded-card border border-border bg-card">
        {total === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted">
            {filtered ? (
              "No readings match these filters."
            ) : (
              <>
                No logger data yet. Readings are pulled daily at 06:00, or{" "}
                <Link href="/admin/logger-data?tab=pull" className="text-primary hover:text-primary-hover">
                  pull data now
                </Link>
                .
              </>
            )}
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-table-head">
                    <SortableTh label="Reading time" sortKey="reading_at" sort={sort} onSort={onSort} className={`${tableHeadCellClass} !px-5`} />
                    <th className={tableHeadCellClass}>Asset</th>
                    <SortableTh label="Logger" sortKey="logger_code" sort={sort} onSort={onSort} className={tableHeadCellClass} />
                    <SortableTh label="Value" sortKey="value" sort={sort} onSort={onSort} className={`${tableHeadCellClass} text-right`} />
                    <SortableTh label="Unit" sortKey="unit" sort={sort} onSort={onSort} className={tableHeadCellClass} />
                    <SortableTh label="Pulled" sortKey="pulled_at" sort={sort} onSort={onSort} className={tableHeadCellClass} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-border hover:bg-row-hover">
                      <td className="px-5 py-2.5 whitespace-nowrap text-ink tabular-nums">
                        {formatDateTime(r.reading_at, timeZone)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="text-ink">{r.asset_name}</span>
                        <span className="ml-2 font-mono text-[12px] text-muted">{r.asset_code}</span>
                        {r.location_name && <span className="block text-xs text-muted">{r.location_name}</span>}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[13px] text-muted">{r.logger_code}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-[13px] text-ink tabular-nums">
                        {formatValue(r.value)}
                      </td>
                      <td className="px-3 py-2.5 text-muted">{r.unit ?? "—"}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap text-muted tabular-nums">
                        {formatDateTime(r.pulled_at, timeZone)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              pageCount={pageCount}
              total={total}
              start={(page - 1) * READINGS_PAGE_SIZE}
              setPage={(p) => go(filter, p)}
              className="border-t border-border px-5 py-3"
            />
          </>
        )}
      </section>
    </div>
  );
}
