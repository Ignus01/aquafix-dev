"use client";

import { useMemo, useState } from "react";
import { formatDate } from "@/lib/incidents/format";
import { BAND_COLOURS, BAND_LABELS, fmt } from "@/lib/dashboard/format";
import type { DashboardLocation, GradingBand } from "@/lib/dashboard/types";
import { ArrowDownIcon, ArrowUpIcon } from "../icons";
import { tableHeadCellClass } from "../ui";

type SortKey =
  | "name"
  | "assets"
  | "inspections"
  | "coverage"
  | "last_inspection"
  | "attention_share"
  | "grading"
  | "open_incidents";

const BAND_RANK: Record<GradingBand, number> = { good: 1, fair: 2, warning: 3, critical: 4 };

const share = (l: DashboardLocation) => (l.graded ? l.attention / l.graded : -1);
const coverage = (l: DashboardLocation) => (l.assets ? l.assets_inspected / l.assets : -1);
const severity = (l: DashboardLocation) =>
  (l.grading?.band ? BAND_RANK[l.grading.band] : 0) * 10_000 + l.attention_assets;

const SORTERS: Record<SortKey, (l: DashboardLocation) => number | string> = {
  name: (l) => l.name.toLowerCase(),
  assets: (l) => l.assets,
  inspections: (l) => l.inspections,
  coverage,
  last_inspection: (l) => l.last_inspection ?? "",
  attention_share: share,
  grading: severity,
  open_incidents: (l) => l.open_incidents,
};

const COLUMNS: { key: SortKey; label: string; numeric?: boolean; title?: string }[] = [
  { key: "name", label: "Site" },
  { key: "grading", label: "Current grading", title: "Worst grading among each asset's latest inspection" },
  { key: "assets", label: "Assets", numeric: true },
  { key: "inspections", label: "Inspections", numeric: true },
  { key: "coverage", label: "Assets inspected", numeric: true },
  { key: "attention_share", label: "Readings needing attention", numeric: true },
  { key: "open_incidents", label: "Open incidents", numeric: true },
  { key: "last_inspection", label: "Last inspection" },
];

const PAGE = 12;

// Power BI "Location Overview": one row per active site, worst first.
export function SitesTable({
  locations,
  timeZone,
  today,
}: {
  locations: DashboardLocation[];
  timeZone: string;
  today: string;
}) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "grading", desc: true });
  const [showAll, setShowAll] = useState(false);

  const rows = useMemo(() => {
    const get = SORTERS[sort.key];
    return [...locations].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      const c = x < y ? -1 : x > y ? 1 : a.name.localeCompare(b.name);
      return sort.desc ? -c : c;
    });
  }, [locations, sort]);

  const visible = showAll ? rows : rows.slice(0, PAGE);
  const staleBefore = Date.parse(today) - 30 * 86_400_000;

  if (locations.length === 0) {
    return <p className="px-5 py-10 text-center text-sm text-muted">No active sites match these filters.</p>;
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-table-head">
            <tr>
              {COLUMNS.map((col) => {
                const on = sort.key === col.key;
                const Arrow = sort.desc ? ArrowDownIcon : ArrowUpIcon;
                return (
                  <th
                    key={col.key}
                    title={col.title}
                    aria-sort={on ? (sort.desc ? "descending" : "ascending") : undefined}
                    className={`${tableHeadCellClass} ${col.numeric ? "text-right" : ""}`}
                  >
                    <button
                      type="button"
                      className={`inline-flex items-center gap-1 uppercase hover:text-ink ${on ? "text-ink" : ""}`}
                      onClick={() =>
                        setSort((s) => ({ key: col.key, desc: s.key === col.key ? !s.desc : col.key !== "name" }))
                      }
                    >
                      {col.label}
                      {on && <Arrow className="h-3 w-3" />}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.map((l) => {
              const cov = coverage(l);
              const stale = l.last_inspection !== null && Date.parse(l.last_inspection) < staleBefore;
              return (
                <tr key={l.id} className="border-t border-border hover:bg-row-hover">
                  <td className="px-3 py-2.5">
                    <div className="font-semibold text-ink">{l.name}</div>
                    <div className="text-xs text-muted">
                      {l.region} · {l.organisation}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    {l.grading ? (
                      <span className="inline-flex items-center gap-2 whitespace-nowrap">
                        <span
                          aria-hidden="true"
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ background: l.grading.band ? BAND_COLOURS[l.grading.band] : BAND_COLOURS.other }}
                        />
                        <span className="text-ink">{l.grading.name}</span>
                        {l.attention_assets > 0 && (
                          <span className="text-xs text-muted">
                            {l.attention_assets} {l.attention_assets === 1 ? "asset" : "assets"}
                          </span>
                        )}
                        <span className="sr-only">
                          {l.grading.band ? `(${BAND_LABELS[l.grading.band]})` : ""}
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted">Not graded</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-[13px] tabular-nums">{fmt(l.assets)}</td>
                  <td className="px-3 py-2.5 text-right font-mono text-[13px] tabular-nums">{fmt(l.inspections)}</td>
                  <td className="px-3 py-2.5">
                    <div className="ml-auto flex w-[120px] flex-col items-end gap-1">
                      <span className="font-mono text-[13px] tabular-nums">
                        {cov < 0 ? "—" : `${Math.round(cov * 100)}%`}
                        <span className="ml-1 text-xs text-muted">
                          {l.assets_inspected}/{l.assets}
                        </span>
                      </span>
                      <span className="h-1.5 w-full overflow-hidden rounded-full bg-black/[.06]">
                        <span
                          className="block h-full rounded-full bg-primary"
                          style={{ width: `${Math.max(0, cov) * 100}%` }}
                        />
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-[13px] tabular-nums">
                    {l.graded ? (
                      <>
                        {((l.attention / l.graded) * 100).toFixed(1)}%
                        <span className="ml-1 text-xs text-muted">
                          {fmt(l.attention)}/{fmt(l.graded)}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-[13px] tabular-nums">
                    {l.open_incidents > 0 ? (
                      <span className="inline-flex items-center rounded-full bg-danger-bg px-2 py-0.5 font-semibold text-danger">
                        {l.open_incidents}
                      </span>
                    ) : (
                      <span className="text-muted">0</span>
                    )}
                  </td>
                  <td className={`px-3 py-2.5 whitespace-nowrap ${stale ? "text-warning" : "text-ink"}`}>
                    {formatDate(l.last_inspection, timeZone)}
                    {stale && <span className="ml-1 text-xs">· 30+ days</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > PAGE && (
        <div className="border-t border-border px-5 py-3 text-center">
          <button
            type="button"
            className="text-[13px] font-semibold text-primary hover:text-primary-hover"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? "Show fewer sites" : `Show all ${rows.length} sites`}
          </button>
        </div>
      )}
    </>
  );
}
