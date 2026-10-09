"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { fmt } from "@/lib/dashboard/format";
import type { DashboardLogger, LoggerStatus } from "@/lib/dashboard/types";
import { ArrowDownIcon, ArrowUpIcon } from "../icons";
import { tableHeadCellClass } from "../ui";
import { Sparkline } from "./charts";
import {
  LONG_GAP_HOURS,
  STATUS_COLOURS,
  STATUS_LABELS,
  avgChange,
  completeness,
  formatGap,
  formatValue,
  readingsHref,
  shortDateTime,
} from "./logger-format";

type SortKey = "name" | "status" | "completeness" | "avg" | "change" | "gap" | "failed";

const STATUS_RANK: Record<LoggerStatus, number> = { never: 4, silent: 3, ok: 1, inactive: 0 };

const SORTERS: Record<SortKey, (l: DashboardLogger) => number | string> = {
  name: (l) => l.name.toLowerCase(),
  // Worst first, then the least complete.
  status: (l) => STATUS_RANK[l.status] * 10 + (1 - (completeness(l) ?? 1)),
  completeness: (l) => completeness(l) ?? -1,
  avg: (l) => l.avg ?? -Infinity,
  change: (l) => Math.abs(avgChange(l) ?? -1),
  gap: (l) => l.longest_gap_hours ?? -1,
  failed: (l) => l.pulls_failed,
};

const COLUMNS: { key: SortKey; label: string; numeric?: boolean; title?: string }[] = [
  { key: "name", label: "Logger" },
  { key: "status", label: "Status · last reading" },
  {
    key: "completeness",
    label: "Days with data",
    numeric: true,
    title:
      "Days with at least one reading, from the period start (or the first reading) up to yesterday; and the readings in the period",
  },
  { key: "avg", label: "Average", numeric: true, title: "Average value, with the lowest and highest below" },
  { key: "change", label: "vs prev.", numeric: true, title: "Change in the average value vs the previous period" },
  { key: "gap", label: "Longest gap", numeric: true, title: "Longest time between two readings in the period" },
  { key: "failed", label: "Failed pulls", numeric: true },
];

const PAGE = 15;

// One row per logger in scope, worst first: is it reporting, how complete is
// its data, and what did it measure.
export function LoggersTable({
  loggers,
  from,
  to,
  timeZone,
}: {
  loggers: DashboardLogger[];
  from: string;
  to: string;
  timeZone: string;
}) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "status", desc: true });
  const [showAll, setShowAll] = useState(false);

  const rows = useMemo(() => {
    const get = SORTERS[sort.key];
    return [...loggers].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      const c = x < y ? -1 : x > y ? 1 : a.name.localeCompare(b.name);
      return sort.desc ? -c : c;
    });
  }, [loggers, sort]);

  if (loggers.length === 0) {
    return (
      <p className="px-5 py-10 text-center text-sm text-muted">
        No assets with a logger match these filters. Set a logger code on an asset in Masterdata.
      </p>
    );
  }

  const visible = showAll ? rows : rows.slice(0, PAGE);

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1000px] text-sm">
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
              <th className={tableHeadCellClass}>Trend</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((l) => {
              const cov = completeness(l);
              const change = avgChange(l);
              const unit = l.unit ? ` ${l.unit}` : "";
              return (
                <tr key={l.id} className="border-t border-border hover:bg-row-hover">
                  <td className="min-w-[160px] px-3 py-2.5">
                    <Link href={readingsHref(l.id, from, to)} className="font-semibold text-ink hover:underline">
                      {l.name}
                    </Link>
                    <div className="text-xs text-muted">
                      {l.logger_code ?? "No logger code"} · {l.location}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className="inline-flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: STATUS_COLOURS[l.status] }}
                      />
                      {STATUS_LABELS[l.status]}
                    </span>
                    {l.last_at && (
                      <div className="pl-[18px] text-xs text-muted">
                        {shortDateTime(l.last_at, timeZone)} ·{" "}
                        <span className="font-mono tabular-nums">
                          {formatValue(l.last_value)}
                          {unit}
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="ml-auto flex w-[110px] flex-col items-end gap-1">
                      <span className="font-mono text-[13px] tabular-nums">
                        {cov === null ? "—" : `${Math.round(cov * 100)}%`}
                        <span className="ml-1 text-xs text-muted">
                          {l.days_with_data}/{l.days_expected}
                        </span>
                      </span>
                      <span className="h-1.5 w-full overflow-hidden rounded-full bg-black/[.06]">
                        <span
                          className={`block h-full rounded-full ${cov !== null && cov < 0.9 ? "bg-warning" : "bg-primary"}`}
                          style={{ width: `${(cov ?? 0) * 100}%` }}
                        />
                      </span>
                      <span className="text-xs text-muted">
                        {fmt(l.readings)} {l.readings === 1 ? "reading" : "readings"}
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-[13px] whitespace-nowrap tabular-nums">
                    {l.readings ? (
                      <>
                        {formatValue(l.avg)}
                        {l.unit && <span className="ml-1 text-xs text-muted">{l.unit}</span>}
                        <div className="text-xs text-muted">
                          {formatValue(l.min)} – {formatValue(l.max)}
                        </div>
                      </>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-[13px] whitespace-nowrap tabular-nums">
                    {change === null ? (
                      <span className="text-muted">—</span>
                    ) : Math.abs(change) < 0.0005 ? (
                      <span className="text-muted">No change</span>
                    ) : (
                      `${change > 0 ? "▲" : "▼"} ${Math.abs(change * 100).toFixed(1)}%`
                    )}
                  </td>
                  <td
                    className={`px-3 py-2.5 text-right font-mono text-[13px] whitespace-nowrap tabular-nums ${
                      (l.longest_gap_hours ?? 0) >= LONG_GAP_HOURS ? "text-warning" : ""
                    }`}
                  >
                    {formatGap(l.longest_gap_hours)}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-[13px] tabular-nums">
                    {l.pulls_failed > 0 ? (
                      <span
                        title={l.last_error ?? undefined}
                        className="inline-flex items-center rounded-full bg-danger-bg px-2 py-0.5 font-semibold text-danger"
                      >
                        {l.pulls_failed}
                      </span>
                    ) : (
                      <span className="text-muted">0</span>
                    )}
                  </td>
                  <td className="w-[160px] py-2.5 pr-4 pl-2">
                    <Sparkline values={l.series} ariaLabel={`${l.name} average per period`} />
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
            {showAll ? "Show fewer loggers" : `Show all ${rows.length} loggers`}
          </button>
        </div>
      )}
    </>
  );
}
