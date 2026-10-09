import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { todayInZone } from "@/lib/inspections/dates";
import { formatDate } from "@/lib/incidents/format";
import { STATUS_LABELS } from "@/lib/incidents/types";
import {
  ATTENTION_COLOUR,
  BAND_COLOURS,
  BAND_LABELS,
  SERIES_COLOUR,
  addDays,
  bucketLabel,
  bucketTitle,
  daysBetween,
  fmt,
  formatRange,
  isYmd,
  pct,
} from "@/lib/dashboard/format";
import {
  PERIOD_PRESETS,
  type FilterOption,
  type GradingBand,
  type HomeDashboard,
  type LocationFilterOption,
  type PeriodPreset,
} from "@/lib/dashboard/types";
import type { LoggerDashboard } from "@/lib/dashboard/types";
import { PageHeader } from "./page-header";
import { BarList, ColumnChart, Legend, SegmentBar } from "./dashboard/charts";
import { Card, Empty, Kpi, Readout, TONE_PILL, delta, shareDelta } from "./dashboard/cards";
import { DashboardFilters, type FilterState } from "./dashboard/filters";
import { LoggerReport } from "./dashboard/logger-report";
import { SitesTable } from "./dashboard/sites-table";

// Admin home: the operations dashboard. Modelled on the AquaFix Power BI
// "Overview" page (slicers, location / grading / incident overviews) and the
// board report (headline KPIs, condition trend, delivery, incidents). All
// figures come from public.home_dashboard() under the caller's RLS.
//
// System admins also get a Loggers tab: the logger readings over the same
// period and filters, from public.logger_dashboard().

const TABS = [
  { key: "operations", label: "Operations" },
  { key: "loggers", label: "Loggers" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const BANDS: GradingBand[] = ["critical", "warning", "fair", "good"];

function resolvePeriod(
  params: Record<string, string | string[] | undefined>,
  today: string,
): { period: PeriodPreset; from: string; to: string } {
  const raw = typeof params.period === "string" ? params.period : "90d";
  const period = (PERIOD_PRESETS.find((p) => p.key === raw)?.key ?? "90d") as PeriodPreset;
  switch (period) {
    case "30d":
      return { period, from: addDays(today, -29), to: today };
    case "ytd":
      return { period, from: `${today.slice(0, 4)}-01-01`, to: today };
    case "12m":
      return { period, from: addDays(today, -364), to: today };
    case "custom": {
      const from = isYmd(params.from) ? params.from : addDays(today, -89);
      const to = isYmd(params.to) ? params.to : today;
      return from <= to ? { period, from, to } : { period, from: to, to: from };
    }
    default:
      return { period: "90d", from: addDays(today, -89), to: today };
  }
}

const uuidParam = (v: unknown) =>
  typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : "";

export default async function HomePage(props: PageProps<"/admin">) {
  const roles = await requireRole(["system_admin", "admin", "user", "viewer"]);
  const params = await props.searchParams;
  const supabase = await createClient();

  // Logger data is readable by system admins only (RLS).
  const tabs = roles.includes("system_admin") ? TABS : TABS.filter((t) => t.key === "operations");
  const tab: Tab = tabs.find((t) => t.key === params.tab)?.key ?? "operations";

  const { data: tzData } = await supabase.rpc("app_time_zone");
  const timeZone = (tzData as string | null) ?? "Africa/Johannesburg";
  const today = todayInZone(timeZone);
  const { period, from, to } = resolvePeriod(params, today);
  const filters: FilterState = {
    period,
    from,
    to,
    region: uuidParam(params.region),
    organisation: uuidParam(params.organisation),
    location: uuidParam(params.location),
  };

  const [dash, regions, organisations, locations] = await Promise.all([
    supabase.rpc(tab === "loggers" ? "logger_dashboard" : "home_dashboard", {
      p_from: from,
      p_to: to,
      p_region_id: filters.region || null,
      p_organisation_id: filters.organisation || null,
      p_location_id: filters.location || null,
    }),
    supabase.from("region").select("id, name").eq("active", true).order("name"),
    supabase.from("organisation").select("id, name").eq("active", true).order("name"),
    supabase
      .from("location")
      .select("id, name, region_id, organisation_id")
      .eq("active", true)
      .eq("is_asset_manager", true)
      .order("name"),
  ]);

  // Switching tabs keeps the period and filters.
  const tabHref = (key: Tab) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (k !== "tab" && typeof v === "string") q.set(k, v);
    }
    if (key !== "operations") q.set("tab", key);
    const qs = q.toString();
    return qs ? `/admin?${qs}` : "/admin";
  };

  const header = (
    <>
      <PageHeader breadcrumb="Home" title={tab === "loggers" ? "Logger data" : "Operations overview"} />
      {tabs.length > 1 && (
        <nav className="mx-4 flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:none] md:mx-8 print:hidden [&::-webkit-scrollbar]:hidden">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={tabHref(t.key)}
              aria-current={tab === t.key ? "page" : undefined}
              className={`border-b-2 px-4 py-2.5 text-sm font-semibold whitespace-nowrap transition-colors ${
                tab === t.key ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      )}
      <DashboardFilters
        state={filters}
        today={today}
        tab={tab === "operations" ? undefined : tab}
        regions={(regions.data ?? []) as FilterOption[]}
        organisations={(organisations.data ?? []) as FilterOption[]}
        locations={(locations.data ?? []) as LocationFilterOption[]}
      />
    </>
  );

  if (dash.error || !dash.data) {
    const missing = dash.error?.code === "PGRST202";
    const fn = tab === "loggers" ? "logger_dashboard" : "home_dashboard";
    return (
      <div className="flex flex-1 flex-col">
        {header}
        <div className="px-4 py-6 md:px-8">
          <div className="rounded-card border border-border bg-card px-6 py-10 text-center">
            <p className="text-sm font-semibold text-ink">The dashboard couldn&rsquo;t be loaded.</p>
            <p className="mt-1 text-sm text-muted">
              {missing
                ? `The database is missing the ${fn} function. Apply the latest migrations (npx supabase db push).`
                : (dash.error?.message ?? "Please try again.")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (tab === "loggers") {
    return (
      <div className="flex flex-1 flex-col">
        {header}
        <LoggerReport data={dash.data as LoggerDashboard} timeZone={timeZone} />
      </div>
    );
  }

  const d = dash.data as HomeDashboard;
  const ids = [...d.inspectors.map((i) => i.id), ...d.overdue_instructions.map((i) => i.account_id)].filter(
    (id): id is string => Boolean(id),
  );
  const names = new Map<string, string>();
  if (ids.length) {
    const { data } = await supabase.rpc("get_user_names", { p_ids: [...new Set(ids)] });
    for (const row of (data ?? []) as { id: string; name: string }[]) names.set(row.id, row.name);
  }

  const bucket = d.period.bucket;
  const series = d.series;
  const columns = (pick: (p: (typeof series)[number]) => Record<string, number>) =>
    series.map((p) => ({ label: bucketLabel(p.bucket, bucket), title: bucketTitle(p.bucket, bucket), values: pick(p) }));
  const partialEdges =
    series.length > 0 && (series[0].bucket < d.period.from || bucket !== "day");

  const attentionShare = d.readings.graded ? d.readings.attention / d.readings.graded : null;
  const prevAttentionShare = d.readings.prev_graded ? d.readings.prev_attention / d.readings.prev_graded : null;
  const completion = d.instructions.due ? d.instructions.due_completed / d.instructions.due : null;
  const gradedTotal = d.gradings.reduce((s, g) => s + g.count, 0);
  const bandTotals = BANDS.map((band) => ({
    band,
    count: d.gradings.filter((g) => g.band === band).reduce((s, g) => s + g.count, 0),
  }));
  const unbanded = d.gradings.filter((g) => !g.band).reduce((s, g) => s + g.count, 0);

  const types = d.incident_types.slice(0, 7);
  const otherTypes = d.incident_types.slice(7).reduce((s, t) => s + t.count, 0);

  return (
    <div className="flex flex-1 flex-col">
      {header}
      <div className="px-4 pt-1 pb-3 text-[13px] text-muted md:px-8">
        <span className="font-semibold text-ink">{formatRange(d.period.from, d.period.to)}</span>
        {" · "}
        {fmt(d.scope.sites)} active {d.scope.sites === 1 ? "site" : "sites"} · {fmt(d.scope.assets)} active assets
        {" · "}compared with the previous {d.period.days} days
      </div>

      <div className="flex flex-col gap-4 px-4 pb-10 md:px-8">
        {/* Headline figures */}
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5" aria-label="Key figures">
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
            label="Assets in orange or red"
            value={fmt(d.readings.assets_attention)}
            note={`of ${fmt(d.readings.assets_graded)} graded assets, by their latest inspection`}
            tone={d.readings.assets_attention > 0 ? "warning" : undefined}
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
            className="sm:col-span-2 xl:col-span-1"
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
        </section>

        {/* Inspections and condition */}
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.55fr_1fr]">
          <Card
            title="Inspection activity"
            caption={`Asset inspections per ${bucket}; orange is the share whose worst reading was graded orange or red.`}
          >
            <ColumnChart
              ariaLabel="Inspections per period"
              height={250}
              labelPeak
              data={columns((p) => ({
                ok: p.inspections - p.attention_inspections,
                attention: p.attention_inspections,
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

          <Card title="Grading mix" caption="Every graded reading in the period, by the grading's colour.">
            {gradedTotal === 0 ? (
              <Empty>No graded readings in this period.</Empty>
            ) : (
              <>
                <SegmentBar
                  ariaLabel="Graded readings by colour band"
                  segments={[
                    ...[...BANDS].reverse().map((b) => ({
                      key: b,
                      label: BAND_LABELS[b],
                      value: bandTotals.find((t) => t.band === b)?.count ?? 0,
                      colour: BAND_COLOURS[b],
                    })),
                    { key: "other", label: "Other", value: unbanded, colour: BAND_COLOURS.other },
                  ]}
                />
                <table className="mt-4 w-full text-[13px]">
                  <thead>
                    <tr className="text-left text-[11px] font-semibold tracking-wider text-muted uppercase">
                      <th className="pb-1.5 font-semibold">Grading</th>
                      <th className="pb-1.5 text-right font-semibold">Readings</th>
                      <th className="pb-1.5 text-right font-semibold">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.gradings.map((g) => (
                      <tr key={g.id} className="border-t border-border/70">
                        <td className="py-1.5">
                          <span className="inline-flex items-center gap-2">
                            <span
                              aria-hidden="true"
                              className="h-2.5 w-2.5 rounded-[2px]"
                              style={{ background: g.band ? BAND_COLOURS[g.band] : BAND_COLOURS.other }}
                            />
                            {g.name}
                            {g.band && <span className="text-xs text-muted">{BAND_LABELS[g.band]}</span>}
                          </span>
                        </td>
                        <td className="py-1.5 text-right font-mono tabular-nums">{fmt(g.count)}</td>
                        <td className="py-1.5 text-right font-mono text-muted tabular-nums">{pct(g.count, gradedTotal, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </Card>
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card
            title="Readings needing attention"
            caption={`Share of graded readings per ${bucket} rated orange or red. Lower is better.`}
          >
            <ColumnChart
              ariaLabel="Share of graded readings rated orange or red over time"
              labelPeak
              unit="percent"
              data={series.map((p) => {
                const graded = p.good + p.fair + p.warning + p.critical + p.other;
                return {
                  label: bucketLabel(p.bucket, bucket),
                  title: bucketTitle(p.bucket, bucket),
                  values: {
                    critical: graded ? (p.critical / graded) * 100 : 0,
                    warning: graded ? (p.warning / graded) * 100 : 0,
                  },
                  extra: [
                    { label: "Orange + red", value: fmt(p.warning + p.critical) },
                    { label: "Graded readings", value: fmt(graded) },
                  ],
                };
              })}
              series={[
                { key: "critical", label: BAND_LABELS.critical, colour: BAND_COLOURS.critical },
                { key: "warning", label: BAND_LABELS.warning, colour: BAND_COLOURS.warning },
              ]}
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <Legend
                items={[
                  { label: BAND_LABELS.critical, colour: BAND_COLOURS.critical },
                  { label: BAND_LABELS.warning, colour: BAND_COLOURS.warning },
                ]}
              />
              {attentionShare !== null && (
                <span className="text-xs text-muted">
                  {(attentionShare * 100).toFixed(1)}% across the period
                </span>
              )}
            </div>
          </Card>

          <Card
            title="Instruction delivery"
            caption={`Instructions by required completion ${bucket}: share marked completed.`}
          >
            <ColumnChart
              ariaLabel="Instructions completed by due period"
              percent
              data={columns((p) => ({ done: p.due_completed, open: p.due - p.due_completed }))}
              series={[
                { key: "done", label: "Completed", colour: SERIES_COLOUR },
                { key: "open", label: "Not completed", colour: "#c3cad6" },
              ]}
            />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <Legend
                items={[
                  { label: "Completed", colour: SERIES_COLOUR },
                  { label: "Not completed", colour: "#c3cad6" },
                ]}
              />
              <span className="text-xs text-muted">
                {fmt(d.instructions.open)} open in total · {fmt(d.instructions.overdue)} past due
              </span>
            </div>
          </Card>
        </section>

        {/* Incidents and people */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          <Card title="Incidents logged" caption={`Per ${bucket}, with the current status of those logged in the period.`}>
            <ColumnChart
              ariaLabel="Incidents logged per period"
              height={180}
              labelPeak
              data={columns((p) => ({ n: p.incidents }))}
              series={[{ key: "n", label: "Incidents", colour: SERIES_COLOUR }]}
            />
            <div className="mt-4 flex flex-col gap-2">
              <SegmentBar
                ariaLabel="Status of incidents logged in the period"
                segments={[
                  { key: "completed", label: STATUS_LABELS.completed, value: d.incident_status.completed, colour: BAND_COLOURS.good },
                  { key: "in_progress", label: STATUS_LABELS.in_progress, value: d.incident_status.in_progress, colour: BAND_COLOURS.fair },
                  { key: "new", label: STATUS_LABELS.new, value: d.incident_status.new, colour: BAND_COLOURS.critical },
                ]}
              />
              <Legend
                items={[
                  { label: STATUS_LABELS.completed, colour: BAND_COLOURS.good, value: fmt(d.incident_status.completed) },
                  { label: STATUS_LABELS.in_progress, colour: BAND_COLOURS.fair, value: fmt(d.incident_status.in_progress) },
                  { label: STATUS_LABELS.new, colour: BAND_COLOURS.critical, value: fmt(d.incident_status.new) },
                ]}
              />
            </div>
          </Card>

          <Card title="Incidents by type" caption="Logged in the period.">
            {types.length === 0 ? (
              <Empty>No incidents logged in this period.</Empty>
            ) : (
              <BarList
                rows={[
                  ...types.map((t) => ({ label: t.name, value: t.count })),
                  ...(otherTypes ? [{ label: "All other types", value: otherTypes }] : []),
                ]}
              />
            )}
            {d.incidents.resolved > 0 && (
              <dl className="mt-5 grid grid-cols-3 border-t border-border pt-3 text-center">
                <Readout label="Resolved" value={fmt(d.incidents.resolved)} />
                <Readout label="Median" value={`${Math.round(d.incidents.median_days ?? 0)} d`} />
                <Readout label="Slowest 10%" value={`${Math.round(d.incidents.p90_days ?? 0)}+ d`} />
              </dl>
            )}
          </Card>

          <Card
            className="lg:col-span-2 xl:col-span-1"
            title="Who captured the work"
            caption="Inspections captured in the period, top six."
          >
            {d.inspectors.length === 0 ? (
              <Empty>No inspections in this period.</Empty>
            ) : (
              <BarList
                rows={d.inspectors.map((i) => ({
                  label: names.get(i.id) ?? "Unknown user",
                  value: i.count,
                  note: pct(i.count, d.inspections.count),
                }))}
              />
            )}
          </Card>
        </section>

        {/* Sites */}
        <section className="rounded-card border border-border bg-card">
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4 pb-3">
            <div>
              <h2 className="text-[15px] font-semibold text-ink">Sites</h2>
              <p className="text-[13px] text-muted">
                Current grading is the worst grading among each asset&rsquo;s latest inspection; activity figures are for
                the period.
              </p>
            </div>
          </div>
          <SitesTable locations={d.locations} timeZone={timeZone} today={d.period.today} />
        </section>

        {/* Open work */}
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
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
              meta: `${n.account_id ? (names.get(n.account_id) ?? "Unknown user") : "Unassigned"} · due ${formatDate(n.required_completed_date, "UTC")} · ${n.nr_completed}/${n.nr_of_allocations} assets done`,
              badge: { text: STATUS_LABELS[n.status], tone: n.status === "new" ? "danger" : "warning" },
              aside: `${daysBetween(n.required_completed_date, d.period.today)} d late`,
            }))}
          />
        </section>
      </div>
    </div>
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
                <span className={`shrink-0 pt-0.5 font-mono text-xs tabular-nums text-danger`}>{item.aside}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
