"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { addDays, bucketTitle, fmt, formatDay, formatRange } from "@/lib/dashboard/format";
import type { Bucket, WaterMeter, WaterUsageIssue, WaterUsageReport as Report } from "@/lib/dashboard/types";
import { ArrowDownIcon, ArrowUpIcon, DownloadIcon } from "../icons";
import { secondaryButtonClass, tableHeadCellClass } from "../ui";
import { Card, Empty, Kpi } from "./cards";
import { Legend } from "./charts";
import { readingsHref, shortDateTime } from "./logger-format";
import { UsageChart } from "./usage-chart";
import {
  bucketise,
  dayRanges,
  daysFrom,
  defaultBucket,
  formatM3,
  meterColour,
  meterStats,
  type MeterStats,
} from "./water-format";

// Home → Water usage (system admins): daily usage per volume meter, by site.
// Every figure comes from public.water_usage_report(), which reads the daily
// usage the database keeps as readings arrive. Meters at one site are shown
// side by side, never added up: a borehole meter and a treated meter often
// measure the same water before and after treatment.

const BUCKETS: { key: Bucket; label: string }[] = [
  { key: "day", label: "Daily" },
  { key: "week", label: "Weekly" },
  { key: "month", label: "Monthly" },
];

const chipClass = (on: boolean) =>
  `h-[30px] rounded-[6px] px-3 text-[13px] font-medium whitespace-nowrap transition-colors ${
    on ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink"
  }`;

type Row = { meter: WaterMeter; stats: MeterStats };
type SortKey = "site" | "avg" | "total" | "peak" | "estimated" | "missing";

const SORTERS: Record<SortKey, (r: Row) => number | string> = {
  site: (r) => `${r.meter.location.toLowerCase()}\u0000${r.meter.name.toLowerCase()}`,
  avg: (r) => r.stats.avg ?? -1,
  total: (r) => r.stats.total,
  peak: (r) => r.stats.peak?.usage ?? -1,
  estimated: (r) => r.stats.estimated,
  missing: (r) => r.stats.missing,
};

const COLUMNS: { key: SortKey; label: string; numeric?: boolean; title?: string }[] = [
  { key: "site", label: "Site · meter" },
  { key: "avg", label: "Average / day", numeric: true, title: "m³ per day, over the days with a figure" },
  { key: "total", label: "Total", numeric: true, title: "m³ over the days with a figure" },
  { key: "peak", label: "Highest day", numeric: true },
  {
    key: "estimated",
    label: "Estimated",
    numeric: true,
    title: "Days with a gap of over an hour in the readings; the usage is spread evenly across the gap",
  },
  { key: "missing", label: "Missing", numeric: true, title: "Days without a figure since the meter's first day" },
];

type Site = { id: string; name: string; region: string; organisation: string; meters: WaterMeter[] };

function sitesOf(meters: WaterMeter[]): Site[] {
  const map = new Map<string, Site>();
  for (const m of meters) {
    if (!map.has(m.location_id)) {
      map.set(m.location_id, { id: m.location_id, name: m.location, region: m.region, organisation: m.organisation, meters: [] });
    }
    map.get(m.location_id)!.meters.push(m);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function csvOf(meters: WaterMeter[], days: string[]): string {
  const rows = [["date", "region", "organisation", "site", "meter", "asset_code", "logger_code", "usage_m3", "status"]];
  const STATUS: Record<string, string> = { o: "ok", e: "estimated", g: "estimated (long gap)", r: "meter reset", "-": "" };
  for (const m of meters) {
    days.forEach((day, i) => {
      if (day < m.first_day) return;
      rows.push([
        day, m.region, m.organisation, m.location, m.name, m.code, m.logger_code ?? "",
        m.usage[i] === null ? "" : m.usage[i]!.toFixed(2), STATUS[m.status[i]] ?? "",
      ]);
    });
  }
  return rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n");
}

export function WaterUsageReport({ data: d, timeZone }: { data: Report; timeZone: string }) {
  const first = d.period.first_day;
  const last = d.period.last_day;
  const days = useMemo(() => (first && last ? daysFrom(first, last) : []), [first, last]);
  const [bucket, setBucket] = useState<Bucket>(() => defaultBucket(days.length));
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "site", desc: false });

  const rows: Row[] = useMemo(() => d.meters.map((meter) => ({ meter, stats: meterStats(meter, days) })), [d.meters, days]);
  const sorted = useMemo(() => {
    const get = SORTERS[sort.key];
    return [...rows].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      const c = x < y ? -1 : x > y ? 1 : 0;
      return sort.desc ? -c : c;
    });
  }, [rows, sort]);
  const sites = useMemo(() => sitesOf(d.meters), [d.meters]);

  const yesterday = addDays(d.period.today, -1);
  const behind = last && d.period.to >= yesterday && last < yesterday ? { from: addDays(last, 1), to: yesterday } : null;

  if (!first || !last) {
    return (
      <div className="flex flex-col gap-4 px-4 pt-3 pb-10 md:px-8">
        <div className="rounded-card border border-border bg-card">
          <Empty>No water usage for this period and these filters.</Empty>
        </div>
        <DataQuality report={d} days={[]} timeZone={timeZone} />
      </div>
    );
  }

  const meterDays = rows.reduce((s, r) => s + r.stats.days + r.stats.missing, 0);
  const estimated = rows.reduce((s, r) => s + r.stats.estimated, 0);
  const missing = rows.reduce((s, r) => s + r.stats.missing, 0);
  const complete = meterDays - estimated - missing;
  const maxAvg = Math.max(1, ...rows.map((r) => r.stats.avg ?? 0));

  const download = () => {
    const url = URL.createObjectURL(new Blob([csvOf(d.meters, days)], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `water-usage-${first}-to-${last}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="px-4 pt-1 pb-3 text-[13px] text-muted md:px-8">
        <span className="font-semibold text-ink">{formatRange(first, last)}</span>
        {" · "}
        {fmt(d.meters.length)} volume {d.meters.length === 1 ? "meter" : "meters"} at {fmt(sites.length)}{" "}
        {sites.length === 1 ? "site" : "sites"}
        {first > d.period.from && <> · usage from {formatDay(first)}</>}
      </div>

      <div className="flex flex-col gap-4 px-4 pb-10 md:px-8">
        {behind && (
          <p className="rounded-card border border-warning/30 bg-warning-bg px-4 py-2.5 text-[13px] text-warning">
            No usage yet for {formatRange(behind.from, behind.to)}: those days&rsquo; readings haven&rsquo;t been pulled.
            Pull them under{" "}
            <Link href="/admin/logger-data" className="font-semibold underline">
              Logger data
            </Link>
            .
          </p>
        )}

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Key figures">
          <Kpi label="Sites" value={fmt(sites.length)} note={`${fmt(new Set(d.meters.map((m) => m.region)).size)} regions`} />
          <Kpi
            label="Volume meters"
            value={fmt(d.meters.length)}
            note={
              d.excluded.length
                ? `${fmt(d.excluded.length)} other ${d.excluded.length === 1 ? "logger" : "loggers"} without usage (see Data quality)`
                : "Every logger in scope reports volume"
            }
          />
          <Kpi
            label="Complete days"
            value={meterDays ? `${((complete / meterDays) * 100).toFixed(1)}%` : "—"}
            note={`${fmt(complete)} of ${fmt(meterDays)} meter-days from complete readings`}
            tone={meterDays && complete / meterDays < 0.9 ? "warning" : undefined}
          />
          <Kpi
            label="Estimated or missing"
            value={fmt(estimated + missing)}
            note={`${fmt(estimated)} estimated across a gap · ${fmt(missing)} without a figure`}
            tone={missing > 0 ? "warning" : undefined}
          />
        </section>

        <section className="min-w-0 rounded-card border border-border bg-card">
          <div className="flex flex-wrap items-baseline justify-between gap-3 px-5 pt-4 pb-3">
            <div>
              <h2 className="text-[15px] font-semibold text-ink">Usage per meter</h2>
              <p className="text-[13px] text-muted">
                In m³. Meters at one site are listed separately: a borehole and a treated meter often measure the same
                water.
              </p>
            </div>
            <button type="button" className={`${secondaryButtonClass} inline-flex items-center gap-2`} onClick={download}>
              <DownloadIcon className="h-4 w-4" />
              Daily CSV
            </button>
          </div>
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
                            setSort((s) => ({ key: col.key, desc: s.key === col.key ? !s.desc : col.key !== "site" }))
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
                {sorted.map(({ meter: m, stats: s }, i) => {
                  const firstOfSite = sort.key !== "site" || sorted[i - 1]?.meter.location_id !== m.location_id;
                  return (
                    <tr
                      key={m.id}
                      className={`hover:bg-row-hover ${firstOfSite ? "border-t border-border" : ""}`}
                    >
                      <td className="min-w-[260px] px-3 py-2">
                        <div className="flex items-start gap-3">
                          <div className="w-[130px] shrink-0">
                            {firstOfSite && (
                              <>
                                <div className="font-semibold text-ink">{m.location}</div>
                                <div className="text-xs text-muted">{m.region}</div>
                              </>
                            )}
                          </div>
                          <div className="min-w-0">
                            <span className="inline-flex items-center gap-2">
                              <span
                                aria-hidden="true"
                                className="h-[3px] w-3.5 shrink-0 rounded-full"
                                style={{ background: meterColour(m.name) }}
                              />
                              <Link href={readingsHref(m.id, first, last)} className="text-ink hover:underline">
                                {m.name}
                              </Link>
                            </span>
                            <div className="pl-[22px] text-xs text-muted">
                              {m.code}
                              {!m.active && " · inactive"}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-2">
                          <span className="font-mono text-[13px] tabular-nums">{formatM3(s.avg)}</span>
                          <span className="h-2 w-[110px] shrink-0">
                            <span
                              className="block h-2 rounded-r-[4px] bg-primary/60"
                              style={{ width: `${((s.avg ?? 0) / maxAvg) * 100}%` }}
                            />
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[13px] tabular-nums">{formatM3(s.total, 0)}</td>
                      <td className="px-3 py-2 text-right font-mono text-[13px] whitespace-nowrap tabular-nums">
                        {s.peak ? (
                          <>
                            {formatM3(s.peak.usage)}
                            <span className="ml-1.5 font-sans text-xs text-muted">{formatDay(s.peak.day, false)}</span>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[13px] tabular-nums">
                        {s.estimated ? s.estimated : <span className="text-muted">0</span>}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-[13px] tabular-nums">
                        {s.missing ? <span className="text-warning">{s.missing}</span> : <span className="text-muted">0</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Usage per site</h2>
            <p className="text-[13px] text-muted">
              {bucket === "day" ? "m³ per day." : `Average m³ per day in each ${bucket}.`} Hollow points include estimated
              days; hover a chart for every meter&rsquo;s figure.
            </p>
          </div>
          <div className="flex rounded-control bg-black/[.05] p-[3px]" role="group" aria-label="Show usage">
            {BUCKETS.map((b) => (
              <button
                key={b.key}
                type="button"
                aria-pressed={bucket === b.key}
                className={chipClass(bucket === b.key)}
                onClick={() => setBucket(b.key)}
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {sites.map((site) => (
            <SiteCard key={site.id} site={site} days={days} bucket={bucket} rows={rows} />
          ))}
        </section>

        <DataQuality report={d} days={days} timeZone={timeZone} />

        <details className="rounded-card border border-border bg-card px-5 py-3 text-[13px] text-muted">
          <summary className="cursor-pointer font-semibold text-ink">How usage is calculated</summary>
          <div className="mt-2 flex max-w-3xl flex-col gap-2 pb-1">
            <p>
              Volume loggers report the meter&rsquo;s running total about every 10 minutes. A day&rsquo;s usage is the
              total at the next midnight minus the total at this midnight, each read by a straight line between the
              readings either side.
            </p>
            <p>
              A day with a gap of over an hour in its readings is <b>estimated</b>: the usage is spread evenly across
              the gap. Totals over a period stay exact, because estimating only moves usage between the days in a gap.
            </p>
            <p>
              Readings that don&rsquo;t continue the meter&rsquo;s total are left out: a second feed reporting
              alongside the real one, or a run that climbs and then falls back to where the meter was. A drop to a new
              total (a replaced meter) leaves that day without a figure. Each case is listed under Data quality.
            </p>
            <p>The figures update as each pull arrives.</p>
          </div>
        </details>
      </div>
    </>
  );
}

function SiteCard({ site, days, bucket, rows }: { site: Site; days: string[]; bucket: Bucket; rows: Row[] }) {
  const [showTable, setShowTable] = useState(false);
  const lines = site.meters.map((m) => ({
    key: m.id,
    label: m.name,
    colour: meterColour(m.name),
    points: bucketise(m, days, bucket),
  }));
  const anyEstimated = lines.some((l) => l.points.some((p) => p.estimated > 0));
  const stats = new Map(rows.map((r) => [r.meter.id, r.stats]));

  return (
    <Card title={site.name}>
      <p className="-mt-0.5 mb-3 text-[13px] text-muted">
        {site.region} · {site.organisation} · average{" "}
        {site.meters.map((m, i) => (
          <span key={m.id}>
            {i > 0 && ", "}
            {m.name.toLowerCase()}{" "}
            <span className="font-mono text-ink tabular-nums">{formatM3(stats.get(m.id)?.avg ?? null)}</span> m³/day
          </span>
        ))}
      </p>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <Legend items={lines.map((l) => ({ label: l.label, colour: l.colour }))} />
        {anyEstimated && (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted">
            <svg width="10" height="10" aria-hidden="true">
              <circle cx="5" cy="5" r="3.5" fill="#fff" stroke="#9aa3b5" strokeWidth="2" />
            </svg>
            Includes estimated days
          </span>
        )}
      </div>
      <UsageChart lines={lines} bucket={bucket} ariaLabel={`Water usage at ${site.name}`} />
      <button
        type="button"
        className="mt-2 text-xs font-semibold text-primary hover:text-primary-hover"
        aria-expanded={showTable}
        onClick={() => setShowTable((v) => !v)}
      >
        {showTable ? "Hide figures" : "Show figures"}
      </button>
      {showTable && (
        <div className="mt-2 max-h-[320px] overflow-auto rounded-control border border-border">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0 bg-table-head">
              <tr>
                <th className={tableHeadCellClass}>{bucket === "day" ? "Day" : bucket === "week" ? "Week" : "Month"}</th>
                {lines.map((l) => (
                  <th key={l.key} className={`${tableHeadCellClass} text-right`}>
                    {l.label}
                    {bucket !== "day" && <span className="normal-case"> (m³, per day)</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines[0].points.map((p, i) => (
                <tr key={p.start} className="border-t border-border">
                  <td className="px-3 py-1.5 whitespace-nowrap">{bucketTitle(p.start, bucket)}</td>
                  {lines.map((l) => {
                    const q = l.points[i];
                    return (
                      <td key={l.key} className="px-3 py-1.5 text-right font-mono whitespace-nowrap tabular-nums">
                        {q.avg === null ? (
                          <span className="text-muted">—</span>
                        ) : bucket === "day" ? (
                          <span className={q.estimated ? "text-muted" : ""}>
                            {q.estimated ? "~" : ""}
                            {formatM3(q.total)}
                          </span>
                        ) : (
                          <>
                            {formatM3(q.total, 0)}
                            <span className="ml-1 text-xs text-muted">
                              {q.estimated ? "~" : ""}
                              {formatM3(q.avg)}
                            </span>
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// What the calculation left out or estimated, and loggers without usage.
function DataQuality({ report: d, days, timeZone }: { report: Report; days: string[]; timeZone: string }) {
  const names = new Map(d.meters.map((m) => [m.id, m]));
  const items: { key: string; title: string; text: string }[] = [];
  const when = (iso: string) => shortDateTime(iso, timeZone);
  const localDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(iso));

  // Days every meter has a long gap on point at the pulls, not the loggers.
  const shared =
    d.meters.length > 1 ? days.filter((_, i) => d.meters.every((m) => m.status[i] === "g")) : [];
  if (shared.length) {
    items.push({
      key: "shared",
      title: "All meters",
      text: `Readings are missing for part of ${dayRanges(shared)}, which points at the pulls rather than the loggers. Pulling those days again under Logger data replaces the estimates.`,
    });
  }

  const issuesBy = new Map<string, WaterUsageIssue[]>();
  for (const i of d.issues) issuesBy.set(i.asset_id, [...(issuesBy.get(i.asset_id) ?? []), i]);

  for (const m of d.meters) {
    const title = `${m.location} – ${m.name}`;
    for (const i of issuesBy.get(m.id) ?? []) {
      const key = `${m.id}-${i.kind}-${i.from_at}`;
      if (i.kind === "duplicate") {
        items.push({
          key,
          title,
          text: `Left out a second feed of ${fmt(i.readings)} readings (${when(i.from_at)} to ${when(i.to_at)}, ${formatM3(i.low)} → ${formatM3(i.high)} m³) reported alongside the meter’s real total.`,
        });
      } else if (i.kind === "excursion") {
        items.push({
          key,
          title,
          text: `The total climbed from ${formatM3(i.low)} to ${formatM3(i.high)} m³ between ${when(i.from_at)} and ${when(i.to_at)}, then fell back to ${formatM3(i.fell_back_to)} m³. Those ${fmt(i.readings)} readings are left out and the days in between are estimated. Worth checking the meter on site.`,
        });
      } else {
        items.push({
          key,
          title,
          text: `The total dropped from ${formatM3(i.low)} to ${formatM3(i.high)} m³ at ${when(i.to_at)} (a replaced or reset meter), so that day has no figure.`,
        });
      }
    }

    // Long gaps of this meter alone, outside the excursions above.
    const excursionDays = new Set(
      (issuesBy.get(m.id) ?? [])
        .filter((i) => i.kind === "excursion")
        .flatMap((i) => daysFrom(localDay(i.from_at), localDay(i.to_at))),
    );
    const gaps = days.filter((day, i) => m.status[i] === "g" && !shared.includes(day) && !excursionDays.has(day));
    if (gaps.length) {
      items.push({
        key: `${m.id}-gaps`,
        title,
        text: `${gaps.length} ${gaps.length === 1 ? "day" : "days"} with a gap of over 6 hours in the readings (${dayRanges(gaps)}).`,
      });
    }
    const missingDays = days.filter((day, i) => day >= m.first_day && m.status[i] === "-");
    if (missingDays.length) {
      items.push({
        key: `${m.id}-missing`,
        title,
        text: `No figure for ${missingDays.length} ${missingDays.length === 1 ? "day" : "days"} (${dayRanges(missingDays)}).`,
      });
    }
  }

  for (const e of d.excluded) {
    items.push({
      key: e.id,
      title: `${e.location} – ${e.name}`,
      text:
        e.reason === "no_readings"
          ? "Not included: no readings received from the logger."
          : `Not included: it measures ${e.unit ?? "an unknown unit"}, not volume.`,
    });
  }

  return (
    <Card
      title="Data quality"
      caption="What the calculation left out or estimated, and loggers in scope without usage."
    >
      {items.length === 0 ? (
        <Empty>Nothing to report: every day comes from complete readings.</Empty>
      ) : (
        <ul className="-mx-5 -mb-4">
          {items.map((item) => {
            const meter = [...names.values()].find((m) => item.key.startsWith(m.id));
            return (
              <li key={item.key} className="flex gap-3 border-t border-border px-5 py-2.5 text-[13px]">
                <span
                  aria-hidden="true"
                  className="mt-[7px] h-[3px] w-3.5 shrink-0 rounded-full"
                  style={{ background: meter ? meterColour(meter.name) : "#9aa3b5" }}
                />
                <p className="text-ink/90">
                  <span className="font-semibold text-ink">{item.title}</span>: {item.text}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
