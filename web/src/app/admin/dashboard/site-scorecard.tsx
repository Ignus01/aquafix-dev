"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { BAND_COLOURS, BAND_LABELS, formatDay } from "@/lib/dashboard/format";
import type { DashboardLocation, GradingBand, OverviewSite, OverviewSites } from "@/lib/dashboard/types";
import { ArrowDownIcon, ArrowUpIcon } from "../icons";
import { tableHeadCellClass } from "../ui";
import { BAND_STYLES } from "./water-format";

// The Overview's site scorecard: one row per active site, one status per
// domain, worst first. Each cell links to where that figure is worked on.

type Tone = "good" | "warn" | "bad" | "none";
type Row = DashboardLocation & { extra: OverviewSite | undefined };

const TONE_DOT: Record<Tone, string> = {
  good: BAND_COLOURS.good,
  warn: BAND_COLOURS.warning,
  bad: BAND_COLOURS.critical,
  none: "#c3cad6",
};
const TONE_WEIGHT: Record<Tone, number> = { bad: 100, warn: 10, good: 0, none: 0 };

const BAND_TONE: Record<GradingBand, Tone> = { good: "good", fair: "good", warning: "warn", critical: "bad" };
const BAND_RANK: Record<GradingBand, number> = { good: 1, fair: 2, warning: 3, critical: 4 };

const coverage = (l: DashboardLocation) => (l.assets ? l.assets_inspected / l.assets : null);

function tones(r: Row, access: OverviewSites["access"]): Record<string, Tone> {
  const e = r.extra;
  return {
    condition: r.grading?.band ? BAND_TONE[r.grading.band] : "none",
    incidents: r.open_incidents > 0 ? "bad" : "good",
    target: !access.water || !e?.target ? "none" : e.target.colour === "red" ? "bad" : e.target.colour === "orange" ? "warn" : "good",
    borehole: !access.water || !e?.borehole ? "none" : e.borehole.pct > 100 ? "bad" : e.borehole.pct > 90 ? "warn" : "good",
    quality: !e?.quality ? "none" : e.quality.out_of_spec > 0 ? "bad" : e.quality.inconclusive > 0 ? "warn" : "good",
    loggers: !access.loggers || !e?.loggers ? "none" : (e.loggers_silent ?? 0) > 0 ? "warn" : "good",
    services: !e ? "none" : e.services_overdue > 0 ? "bad" : e.services_due > 0 ? "warn" : "good",
  };
}

type SortKey = "severity" | "name" | "condition" | "coverage" | "incidents" | "target" | "borehole" | "quality" | "loggers" | "services";

function Dot({ tone, colour }: { tone: Tone; colour?: string }) {
  return (
    <span
      aria-hidden="true"
      className="h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ background: colour ?? TONE_DOT[tone] }}
    />
  );
}

function Cell({
  tone,
  colour,
  href,
  title,
  children,
}: {
  tone: Tone;
  colour?: string;
  href?: string;
  title?: string;
  children: React.ReactNode;
}) {
  const body = (
    <span className={`inline-flex items-center gap-2 whitespace-nowrap ${tone === "none" ? "text-muted" : "text-ink"}`} title={title}>
      <Dot tone={tone} colour={colour} />
      {children}
    </span>
  );
  return (
    <td className="px-3 py-2.5 text-[13px]">
      {href && tone !== "none" ? (
        <Link href={href} className="hover:underline">
          {body}
        </Link>
      ) : (
        body
      )}
    </td>
  );
}

const PAGE = 12;

export function SiteScorecard({
  locations,
  extras,
  query,
}: {
  locations: DashboardLocation[];
  extras: OverviewSites;
  // The page's period and filters, kept on links to the other tabs.
  query: string;
}) {
  const { access } = extras;
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "severity", desc: true });
  const [showAll, setShowAll] = useState(false);

  const rows = useMemo(() => {
    const byId = new Map(extras.sites.map((s) => [s.id, s]));
    const all: (Row & { t: Record<string, Tone>; severity: number })[] = locations.map((l) => {
      const row = { ...l, extra: byId.get(l.id) };
      const t = tones(row, access);
      return { ...row, t, severity: Object.values(t).reduce((s, tone) => s + TONE_WEIGHT[tone], 0) };
    });
    const get: Record<SortKey, (r: (typeof all)[number]) => number | string> = {
      severity: (r) => r.severity,
      name: (r) => r.name.toLowerCase(),
      condition: (r) => (r.grading?.band ? BAND_RANK[r.grading.band] : 0) * 10_000 + r.attention_assets,
      coverage: (r) => coverage(r) ?? -1,
      incidents: (r) => r.open_incidents,
      target: (r) => r.extra?.target?.pct ?? -1,
      borehole: (r) => r.extra?.borehole?.pct ?? -1,
      quality: (r) => (r.extra?.quality ? r.extra.quality.out_of_spec * 100 + r.extra.quality.inconclusive : -1),
      loggers: (r) => r.extra?.loggers_silent ?? -1,
      services: (r) => (r.extra ? r.extra.services_overdue * 1000 + r.extra.services_due : -1),
    };
    return all.sort((a, b) => {
      const x = get[sort.key](a);
      const y = get[sort.key](b);
      const c = x < y ? -1 : x > y ? 1 : -a.name.localeCompare(b.name);
      return sort.desc ? -c : c;
    });
  }, [locations, extras, access, sort]);

  if (locations.length === 0) {
    return <p className="px-5 py-10 text-center text-sm text-muted">No active sites match these filters.</p>;
  }

  const columns: { key: SortKey; label: string; title?: string; show?: boolean }[] = [
    { key: "name", label: "Site" },
    { key: "condition", label: "Condition", title: "Worst grading among each asset's latest inspection" },
    { key: "coverage", label: "Inspected", title: "Share of the site's active assets inspected in the period" },
    { key: "incidents", label: "Incidents", title: "Open incidents" },
    { key: "target", label: "Water target", title: "Average daily treated water in the period, as a share of the site's target", show: access.water },
    { key: "borehole", label: "Borehole", title: "Average daily borehole usage in the period, as a share of the limit", show: access.water },
    { key: "quality", label: "Lab quality", title: "The site's latest lab sample" },
    { key: "loggers", label: "Loggers", title: "Active loggers that sent a reading in the last 48 hours", show: access.loggers },
    { key: "services", label: "Services", title: "Open services that are overdue or due within 30 days" },
  ];
  const shown = columns.filter((c) => c.show !== false);
  const visible = showAll ? rows : rows.slice(0, PAGE);
  const tabHref = (tab: string, id: string) => {
    const q = new URLSearchParams(query);
    q.set("tab", tab);
    q.set("location", id);
    return `/admin?${q.toString()}`;
  };
  const siteHref = (id: string) => {
    const q = new URLSearchParams(query);
    q.set("location", id);
    return `/admin?${q.toString()}`;
  };

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[920px] text-sm">
          <thead className="bg-table-head">
            <tr>
              {shown.map((col) => {
                const on = sort.key === col.key;
                const Arrow = sort.desc ? ArrowDownIcon : ArrowUpIcon;
                return (
                  <th
                    key={col.key}
                    title={col.title}
                    aria-sort={on ? (sort.desc ? "descending" : "ascending") : undefined}
                    className={tableHeadCellClass}
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
            {visible.map((r) => {
              const e = r.extra;
              const cov = coverage(r);
              return (
                <tr key={r.id} className="border-t border-border hover:bg-row-hover">
                  <td className="px-3 py-2.5">
                    <Link href={siteHref(r.id)} className="font-semibold text-ink hover:underline">
                      {r.name}
                    </Link>
                    <div className="text-xs text-muted">
                      {r.region} · {r.organisation}
                    </div>
                  </td>
                  <Cell
                    tone={r.t.condition}
                    colour={r.grading ? (r.grading.band ? BAND_COLOURS[r.grading.band] : BAND_COLOURS.other) : undefined}
                    title={r.grading?.band ? BAND_LABELS[r.grading.band] : undefined}
                  >
                    {r.grading ? (
                      <>
                        {r.grading.name}
                        {r.attention_assets > 0 && (
                          <span className="text-xs text-muted">
                            {r.attention_assets} {r.attention_assets === 1 ? "asset" : "assets"}
                          </span>
                        )}
                      </>
                    ) : (
                      "Not graded"
                    )}
                  </Cell>
                  <td className="px-3 py-2.5">
                    {cov === null ? (
                      <span className="text-[13px] text-muted">No assets</span>
                    ) : (
                      <div className="flex w-[104px] flex-col gap-1">
                        <span className="font-mono text-[13px] tabular-nums">
                          {Math.round(cov * 100)}%
                          <span className="ml-1 text-xs text-muted">
                            {r.assets_inspected}/{r.assets}
                          </span>
                        </span>
                        <span className="h-1.5 w-full overflow-hidden rounded-full bg-black/[.06]">
                          <span className="block h-full rounded-full bg-primary" style={{ width: `${cov * 100}%` }} />
                        </span>
                      </div>
                    )}
                  </td>
                  <Cell tone={r.t.incidents} href="/admin/incidents">
                    {r.open_incidents > 0 ? `${r.open_incidents} open` : "None open"}
                  </Cell>
                  {access.water && (
                    <Cell
                      tone={r.t.target}
                      colour={e?.target?.colour ? BAND_STYLES[e.target.colour].swatch : undefined}
                      href={tabHref("water", r.id)}
                      title={e?.target ? `On target ${e.target.days_on} of ${e.target.days} days` : undefined}
                    >
                      {e?.target ? `${Math.round(e.target.pct)}%` : "No target"}
                    </Cell>
                  )}
                  {access.water && (
                    <Cell
                      tone={r.t.borehole}
                      href={tabHref("water", r.id)}
                      title={e?.borehole ? `Over the limit on ${e.borehole.days_over} of ${e.borehole.days} days` : undefined}
                    >
                      {e?.borehole ? `${Math.round(e.borehole.pct)}%` : "No limit"}
                    </Cell>
                  )}
                  <Cell
                    tone={r.t.quality}
                    href={e?.quality ? `/admin/quality/samples/${e.quality.sample_id}` : undefined}
                    title={e?.quality ? `Sampled ${formatDay(e.quality.sampled_on)}` : undefined}
                  >
                    {!e?.quality
                      ? "No sample"
                      : e.quality.out_of_spec > 0
                        ? `${e.quality.out_of_spec} out of limits`
                        : e.quality.inconclusive > 0
                          ? `${e.quality.inconclusive} inconclusive`
                          : "In limits"}
                    {e?.quality && <span className="text-xs text-muted">{formatDay(e.quality.sampled_on)}</span>}
                  </Cell>
                  {access.loggers && (
                    <Cell tone={r.t.loggers} href={tabHref("loggers", r.id)}>
                      {e?.loggers ? `${e.loggers - (e.loggers_silent ?? 0)}/${e.loggers} reporting` : "None"}
                    </Cell>
                  )}
                  <Cell tone={r.t.services} href="/admin/services">
                    {!e
                      ? "—"
                      : e.services_overdue > 0
                        ? `${e.services_overdue} overdue`
                        : e.services_due > 0
                          ? `${e.services_due} due`
                          : "None due"}
                  </Cell>
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
