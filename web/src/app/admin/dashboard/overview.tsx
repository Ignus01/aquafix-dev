import Link from "next/link";
import { formatPeriod } from "@/lib/billing/format";
import { formatDate } from "@/lib/incidents/format";
import { STATUS_LABELS } from "@/lib/incidents/types";
import { SERVICE_TYPE_LABELS } from "@/lib/services/types";
import {
  ATTENTION_COLOUR,
  BAND_COLOURS,
  SERIES_COLOUR,
  bucketLabel,
  bucketTitle,
  daysBetween,
  fmt,
  formatDay,
  formatRange,
  pct,
} from "@/lib/dashboard/format";
import type { HomeDashboard, OverviewAttention, OverviewExtras, OverviewSites } from "@/lib/dashboard/types";
import { Card, Empty, Kpi, TONE_PILL, delta, shareDelta } from "./cards";
import { ColumnChart, Legend } from "./charts";
import { SiteScorecard } from "./site-scorecard";

// The Overview tab, in the parts the page streams: each is an async Server
// Component that awaits only the calls it draws from, so the attention strip
// doesn't wait for the scorecard. The page starts the calls and hands the
// same promises to every part that needs them.

export type Rpc<T> = Promise<{ data: T | null; error: { code?: string; message: string } | null }>;

const LABOUR_COLOUR = "#7650c8";
const rand = (n: number) => `R ${fmt(Math.round(n))}`;

// A failed call, in place of the part it feeds.
export function LoadError({ what, error }: { what: string; error: { code?: string; message: string } | null }) {
  // PGRST202: no such function; PGRST205: no such table or view.
  const missing = ["PGRST202", "PGRST205"].includes(error?.code ?? "");
  return (
    <div className="rounded-card border border-border bg-card px-6 py-8 text-center">
      <p className="text-sm font-semibold text-ink">{what} couldn&rsquo;t be loaded.</p>
      <p className="mt-1 text-sm text-muted">
        {missing
          ? "The database is missing part of the dashboard. Apply the latest migrations (npx supabase db push)."
          : (error?.message ?? "Please try again.")}
      </p>
    </div>
  );
}

export function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-card border border-border bg-card ${className}`} aria-hidden="true" />;
}

// ---- Needs attention -------------------------------------------------------

type Tile = { count: number | null; label: string; hint: string; href: string; tone: "danger" | "warning" | "neutral" };

const TILE_TONE = {
  danger: "border-danger/25 bg-danger-bg text-danger",
  warning: "border-warning/25 bg-warning-bg text-warning",
  neutral: "border-border bg-card text-ink",
} as const;

export async function AttentionStrip({ data, query }: { data: Rpc<OverviewAttention>; query: string }) {
  const { data: a, error } = await data;
  if (error || !a) return <LoadError what="What needs attention" error={error} />;

  const tab = (key: string) => {
    const q = new URLSearchParams(query);
    for (const k of ["period", "from", "to"]) q.delete(k);
    q.set("tab", key);
    return `/admin?${q.toString()}`;
  };
  const t = a.thresholds;
  const tiles: Tile[] = [
    {
      count: a.overdue_instructions,
      label: "Overdue instructions",
      hint: "Not completed and past their required date",
      href: "/admin/inspections?tab=instructions",
      tone: "danger",
    },
    {
      count: a.stale_incidents,
      label: `Incidents open ${t.incident_days}+ days`,
      hint: `Not completed ${t.incident_days} days or more after they were logged`,
      href: "/admin/incidents",
      tone: "danger",
    },
    {
      count: a.services_overdue,
      label: "Services overdue",
      hint: "Open services past their due date",
      href: "/admin/services",
      tone: "danger",
    },
    {
      count: a.borehole_over_sites,
      label: "Sites over borehole limit",
      hint: `Average daily borehole usage over the last ${t.water_days} days is above the limit`,
      href: tab("water"),
      tone: "warning",
    },
    {
      count: a.target_red_sites,
      label: "Sites well below water target",
      hint: `Average daily treated water over the last ${t.water_days} days is in the site's red band`,
      href: tab("water"),
      tone: "warning",
    },
    {
      count: a.lab_out_sites,
      label: "Sites with lab results out of limits",
      hint: "The site's latest lab sample has a result outside its limits",
      href: "/admin/quality",
      tone: "warning",
    },
    {
      count: a.uninspected_assets,
      label: `Assets not inspected in ${t.inspection_days} days`,
      hint: `Active assets with inspections set up and none captured in the last ${t.inspection_days} days`,
      href: "/admin/inspections?tab=activities",
      tone: "warning",
    },
    {
      count: a.silent_loggers,
      label: "Silent loggers",
      hint: `Active loggers whose latest reading is over ${t.logger_hours} hours old`,
      href: tab("loggers"),
      tone: "warning",
    },
    {
      count: a.draft_invoices,
      label: "Draft invoices to approve",
      hint: "Invoices generated and not yet approved",
      href: "/admin/billing",
      tone: "neutral",
    },
  ].filter((tile): tile is Tile => tile.count !== null);

  const open = tiles.filter((tile) => (tile.count ?? 0) > 0).length;

  return (
    <section aria-label="Needs attention">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-ink">Needs attention</h2>
        <p className="text-[13px] text-muted">
          {open === 0 ? "Nothing is waiting right now." : "As things stand now, whatever period is chosen."}
        </p>
      </div>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {tiles.map((tile) => {
          const count = tile.count ?? 0;
          return (
            <li key={tile.label}>
              <Link
                href={tile.href}
                title={tile.hint}
                className={`flex h-full flex-col gap-1 rounded-card border px-4 py-3 transition-shadow hover:shadow-sm ${
                  count > 0 ? TILE_TONE[tile.tone] : "border-border bg-card text-muted"
                }`}
              >
                <span className="text-[26px] leading-none font-semibold tracking-tight tabular-nums">{fmt(count)}</span>
                <span className={`text-[13px] leading-snug ${count > 0 ? "" : "text-muted"}`}>{tile.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function AttentionSkeleton() {
  return (
    <div>
      <div className="mb-2 h-[22px]" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-[76px]" />
        ))}
      </div>
    </div>
  );
}

// ---- Key figures -----------------------------------------------------------

export async function KeyFigures({ dash, extras }: { dash: Rpc<HomeDashboard>; extras: Rpc<OverviewExtras> }) {
  const [{ data: d, error }, { data: x, error: xError }] = await Promise.all([dash, extras]);
  if (error || !d) return <LoadError what="The key figures" error={error} />;
  if (xError || !x) return <LoadError what="The key figures" error={xError} />;

  const series = d.series;
  const attentionShare = d.readings.graded ? d.readings.attention / d.readings.graded : null;
  const prevAttentionShare = d.readings.prev_graded ? d.readings.prev_attention / d.readings.prev_graded : null;
  const completion = d.instructions.due ? d.instructions.due_completed / d.instructions.due : null;
  const spend = x.services.parts + x.services.labour;

  return (
    <>
      <div className="text-[13px] text-muted">
        <span className="font-semibold text-ink">{formatRange(d.period.from, d.period.to)}</span>
        {" · "}
        {fmt(d.scope.sites)} active {d.scope.sites === 1 ? "site" : "sites"} · {fmt(d.scope.assets)} active assets
        {" · "}compared with the previous {d.period.days} {d.period.days === 1 ? "day" : "days"}
      </div>
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Key figures">
        <Kpi
          label="Inspections"
          value={fmt(d.inspections.count)}
          delta={delta(d.inspections.count, d.inspections.prev, true)}
          note={`${fmt(d.inspections.assets_inspected)} assets by ${d.inspections.inspectors} ${d.inspections.inspectors === 1 ? "inspector" : "inspectors"}`}
          trend={series.map((p) => p.inspections)}
          href="/admin/inspections?tab=activities"
        />
        <Kpi
          label="Readings needing attention"
          value={attentionShare === null ? "—" : `${(attentionShare * 100).toFixed(1)}%`}
          delta={shareDelta(attentionShare, prevAttentionShare)}
          note={`${fmt(d.readings.attention)} of ${fmt(d.readings.graded)} graded readings rated orange or red`}
          trend={series.map((p) => {
            const graded = p.good + p.fair + p.warning + p.critical + p.other;
            return graded ? ((p.warning + p.critical) / graded) * 100 : null;
          })}
          trendColour={ATTENTION_COLOUR}
        />
        <Kpi
          label="Instructions completed"
          value={completion === null ? "—" : `${Math.round(completion * 100)}%`}
          note={`${fmt(d.instructions.due_completed)} of ${fmt(d.instructions.due)} due in the period`}
          flag={
            d.instructions.overdue > 0
              ? { text: `${fmt(d.instructions.overdue)} overdue`, tone: "danger" }
              : { text: "None overdue", tone: "success" }
          }
          trend={series.map((p) => (p.due ? (p.due_completed / p.due) * 100 : null))}
          href="/admin/inspections?tab=instructions"
        />
        <Kpi
          label="Open incidents"
          value={fmt(d.incidents.open)}
          note={`${d.incidents.open_new} new · ${d.incidents.open_in_progress} in progress · ${fmt(d.incidents.logged)} logged in period`}
          flag={
            d.incidents.median_days !== null
              ? { text: `Median ${Math.round(d.incidents.median_days)} days to resolve`, tone: "neutral" }
              : undefined
          }
          tone={d.incidents.open > 0 ? "danger" : undefined}
          href="/admin/incidents"
        />
        {x.water && (
          <Kpi
            label="Days on water target"
            value={x.water.days ? pct(x.water.days_on, x.water.days) : "—"}
            note={
              x.water.days
                ? `${fmt(x.water.days_on)} of ${fmt(x.water.days)} site-days across ${x.water.sites} ${x.water.sites === 1 ? "site" : "sites"} with a target`
                : "No site with a target has usage in this period"
            }
            href="/admin?tab=water"
          />
        )}
        <Kpi
          label="Lab results in limits"
          value={x.quality.checked ? pct(x.quality.ok, x.quality.checked, 1) : "—"}
          note={
            x.quality.checked
              ? `${fmt(x.quality.ok)} of ${fmt(x.quality.checked)} results that have limits`
              : "No lab results in this period"
          }
          tone={x.quality.checked && x.quality.ok < x.quality.checked ? "warning" : undefined}
          href="/admin/quality"
        />
        <Kpi
          label="Maintenance spend"
          value={rand(spend)}
          delta={delta(spend, x.services.prev_spend, false)}
          note={`Parts ${rand(x.services.parts)} · labour ${rand(x.services.labour)} · ${fmt(x.services.completed)} ${x.services.completed === 1 ? "service" : "services"} completed`}
          flag={
            x.services.overdue > 0
              ? { text: `${fmt(x.services.overdue)} overdue`, tone: "danger" }
              : { text: "None overdue", tone: "success" }
          }
          trend={x.series.map((p) => p.parts + p.labour)}
          href="/admin/services"
        />
        {x.billing && (
          <Kpi
            label="Billed"
            value={rand(x.billing.amount)}
            note={`${formatPeriod(x.billing.period)} run · ${fmt(Math.round(x.billing.usage))} kL · ${fmt(x.billing.invoices)} ${x.billing.invoices === 1 ? "invoice" : "invoices"}`}
            flag={
              x.billing.drafts > 0
                ? { text: `${fmt(x.billing.drafts)} to approve`, tone: "warning" }
                : { text: "All approved", tone: "success" }
            }
            href="/admin/billing"
          />
        )}
      </section>
    </>
  );
}

export function KeyFiguresSkeleton() {
  return (
    <>
      <div className="h-[20px]" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-[150px]" />
        ))}
      </div>
    </>
  );
}

// ---- Site scorecard --------------------------------------------------------

export async function Scorecard({
  dash,
  sites,
  query,
}: {
  dash: Rpc<HomeDashboard>;
  sites: Rpc<OverviewSites>;
  query: string;
}) {
  const [{ data: d, error }, { data: s, error: sError }] = await Promise.all([dash, sites]);
  if (error || !d) return <LoadError what="The site scorecard" error={error} />;
  if (sError || !s) return <LoadError what="The site scorecard" error={sError} />;

  return (
    <section id="sites" className="rounded-card border border-border bg-card">
      <div className="px-5 pt-4 pb-3">
        <h2 className="text-[15px] font-semibold text-ink">Site scorecard</h2>
        <p className="text-[13px] text-muted">
          One row per active site, the sites needing most attention first. Condition, incidents, lab quality, loggers
          and services are as things stand now; inspected and water figures are for the period.
        </p>
      </div>
      <SiteScorecard locations={d.locations} extras={s} query={query} />
    </section>
  );
}

// ---- Trends and work queues ------------------------------------------------

export async function TrendsAndQueues({
  dash,
  extras,
  timeZone,
}: {
  dash: Rpc<HomeDashboard>;
  extras: Rpc<OverviewExtras>;
  timeZone: string;
}) {
  const [{ data: d, error }, { data: x, error: xError }] = await Promise.all([dash, extras]);
  // The key figures above already report a failed call.
  if (error || !d || xError || !x) return null;

  const bucket = d.period.bucket;
  const series = d.series;
  const axis = (b: string) => ({ label: bucketLabel(b, bucket), title: bucketTitle(b, bucket) });
  const partialEdges = series.length > 0 && (series[0].bucket < d.period.from || bucket !== "day");
  const closed = new Map(x.series.map((p) => [p.bucket, p.closed]));
  const opened = series.reduce((sum, p) => sum + p.incidents, 0);
  const closedTotal = x.series.reduce((sum, p) => sum + p.closed, 0);
  const net = opened - closedTotal;
  const spend = x.services.parts + x.services.labour;

  return (
    <>
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card
          title="Inspection activity"
          caption={`Asset inspections per ${bucket}; orange is the share whose worst reading was graded orange or red.`}
        >
          <ColumnChart
            ariaLabel="Inspections per period"
            labelPeak
            data={series.map((p) => ({
              ...axis(p.bucket),
              values: { ok: p.inspections - p.attention_inspections, attention: p.attention_inspections },
            }))}
            series={[
              { key: "ok", label: "Other inspections", colour: SERIES_COLOUR },
              { key: "attention", label: "Graded orange or red", colour: ATTENTION_COLOUR },
            ]}
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <Legend
              items={[
                { label: "Other inspections", colour: SERIES_COLOUR },
                { label: "Graded orange or red", colour: ATTENTION_COLOUR },
              ]}
            />
            {partialEdges && <span className="text-xs text-muted">First and last {bucket}s may be partial</span>}
          </div>
        </Card>

        <Card
          title="Incident backlog"
          caption={`Incidents logged and incidents closed per ${bucket}. The backlog grows when more are logged than closed.`}
        >
          <ColumnChart
            ariaLabel="Incidents logged and closed per period"
            grouped
            data={series.map((p) => ({
              ...axis(p.bucket),
              values: { opened: p.incidents, closed: closed.get(p.bucket) ?? 0 },
            }))}
            series={[
              { key: "opened", label: "Logged", colour: SERIES_COLOUR },
              { key: "closed", label: "Closed", colour: BAND_COLOURS.good },
            ]}
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <Legend
              items={[
                { label: "Logged", colour: SERIES_COLOUR, value: fmt(opened) },
                { label: "Closed", colour: BAND_COLOURS.good, value: fmt(closedTotal) },
              ]}
            />
            <span className="text-xs text-muted">
              {net === 0 ? "Backlog unchanged" : `Backlog ${net > 0 ? "up" : "down"} ${fmt(Math.abs(net))} in the period`}
            </span>
          </div>
        </Card>

        <Card
          title="Maintenance spend"
          caption={`Cost of services completed per ${bucket}, split into parts and labour.`}
        >
          {spend === 0 ? (
            <Empty>No services were completed in this period.</Empty>
          ) : (
            <>
              <ColumnChart
                ariaLabel="Service spend per period"
                unit="rand"
                data={x.series.map((p) => ({ ...axis(p.bucket), values: { parts: p.parts, labour: p.labour } }))}
                series={[
                  { key: "parts", label: "Parts", colour: SERIES_COLOUR },
                  { key: "labour", label: "Labour", colour: LABOUR_COLOUR },
                ]}
              />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <Legend
                  items={[
                    { label: "Parts", colour: SERIES_COLOUR, value: rand(x.services.parts) },
                    { label: "Labour", colour: LABOUR_COLOUR, value: rand(x.services.labour) },
                  ]}
                />
                {x.services.completed > 0 && (
                  <span className="text-xs text-muted">
                    {fmt(x.services.on_time)} of {fmt(x.services.completed)} completed on time
                  </span>
                )}
              </div>
            </>
          )}
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <ListCard
          title="Open incidents"
          caption={`Oldest first · ${fmt(d.incidents.open)} open`}
          href="/admin/incidents"
          empty="No open incidents."
          items={d.open_incidents.map((i) => ({
            key: String(i.reference),
            href: `/admin/incidents/${i.reference}`,
            title: `#${i.reference} · ${i.location}`,
            detail: i.comment,
            meta: `${i.type} · logged ${formatDate(i.incident_date, timeZone)}`,
            badge: { text: STATUS_LABELS[i.status], tone: i.status === "new" ? "danger" : "warning" },
            aside: `${daysBetween(i.incident_date.slice(0, 10), d.period.today)} d open`,
            late: true,
          }))}
        />
        <ListCard
          title="Overdue instructions"
          caption={`Longest overdue first · ${fmt(d.instructions.overdue)} past their required date`}
          href="/admin/inspections?tab=instructions"
          empty="Nothing overdue."
          items={d.overdue_instructions.map((n) => ({
            key: String(n.legacy_uid),
            href: `/admin/inspections/instructions/${n.legacy_uid}`,
            title: `${n.legacy_uid} · ${n.name}`,
            meta: `${n.account_id ? (x.assignees[n.account_id] ?? "Unknown user") : "Unassigned"} · due ${formatDate(n.required_completed_date, "UTC")} · ${n.nr_completed}/${n.nr_of_allocations} assets done`,
            badge: { text: STATUS_LABELS[n.status], tone: n.status === "new" ? "danger" : "warning" },
            aside: `${daysBetween(n.required_completed_date, d.period.today)} d late`,
            late: true,
          }))}
        />
        <ListCard
          title="Services due"
          caption={`Soonest first · ${fmt(x.services.overdue)} overdue · ${fmt(x.services.due_soon)} due within 30 days`}
          href="/admin/services"
          empty="No services are overdue or due within 30 days."
          items={x.service_queue.map((s) => {
            const days = daysBetween(s.due_date, d.period.today);
            return {
              key: String(s.reference),
              href: `/admin/services/${s.reference}`,
              title: `#${s.reference} · ${s.asset}`,
              meta: `${s.location} · ${SERVICE_TYPE_LABELS[s.service_type]} · due ${formatDay(s.due_date)}`,
              badge:
                days > 0
                  ? { text: "Overdue", tone: "danger" as const }
                  : { text: "Due soon", tone: "warning" as const },
              aside: days > 0 ? `${days} d late` : days === 0 ? "Today" : `in ${-days} d`,
              late: days > 0,
            };
          })}
        />
      </section>
    </>
  );
}

export function BodySkeleton() {
  return (
    <>
      <Skeleton className="h-[420px]" />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-[320px]" />
        ))}
      </div>
    </>
  );
}

type ListItem = {
  key: string;
  href: string;
  title: string;
  detail?: string;
  meta: string;
  badge: { text: string; tone: keyof typeof TONE_PILL };
  aside: string;
  late: boolean;
};

function ListCard({
  title,
  caption,
  href,
  empty,
  items,
}: {
  title: string;
  caption: string;
  href: string;
  empty: string;
  items: ListItem[];
}) {
  return (
    <div className="min-w-0 rounded-card border border-border bg-card">
      <div className="flex items-baseline justify-between gap-3 px-5 pt-4 pb-3">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          <p className="text-[13px] text-muted">{caption}</p>
        </div>
        <Link href={href} className="shrink-0 text-xs font-semibold text-primary hover:text-primary-hover">
          View all
        </Link>
      </div>
      {items.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item.key} className="border-t border-border">
              <Link href={item.href} className="flex items-start gap-3 px-5 py-3 hover:bg-row-hover">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold text-ink">{item.title}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE_PILL[item.badge.tone]}`}>
                      {item.badge.text}
                    </span>
                  </div>
                  {item.detail && <p className="mt-0.5 line-clamp-1 text-[13px] text-ink/80">{item.detail}</p>}
                  <p className="mt-0.5 text-xs text-muted">{item.meta}</p>
                </div>
                <span
                  className={`shrink-0 pt-0.5 font-mono text-xs tabular-nums ${item.late ? "text-danger" : "text-muted"}`}
                >
                  {item.aside}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
