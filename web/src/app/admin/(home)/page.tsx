import Link from "next/link";
import { Suspense } from "react";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { todayInZone } from "@/lib/inspections/dates";
import { addDays, isYmd } from "@/lib/dashboard/format";
import {
  DEFAULT_PERIOD,
  PERIOD_PRESETS,
  type FilterOption,
  type HomeDashboard,
  type LocationFilterOption,
  type OverviewAttention,
  type OverviewExtras,
  type OverviewSites,
  type PeriodPreset,
} from "@/lib/dashboard/types";
import type {
  LoggerDashboard,
  WaterBoreholeMatrix,
  WaterTargetMatrix,
  WaterUsageReport as WaterUsageData,
} from "@/lib/dashboard/types";
import { PageHeader } from "../page-header";
import { DashboardFilters, type FilterState } from "../dashboard/filters";
import { LoggerReport } from "../dashboard/logger-report";
import {
  AttentionSkeleton,
  AttentionStrip,
  BodySkeleton,
  KeyFigures,
  KeyFiguresSkeleton,
  LoadError,
  Scorecard,
  Skeleton,
  TrendsAndQueues,
  type Rpc,
} from "../dashboard/overview";
import { QualityReport } from "../dashboard/quality-report";
import { WaterUsageReport } from "../dashboard/water-usage-report";
import { buildQualityReport } from "@/lib/quality/report";
import { latestSampleBySite, qualityReadings } from "@/lib/quality/site-quality";

// Admin home: the dashboard. The page sends its header at once and streams
// the rest: the filters and each part of a tab sit in their own Suspense
// boundary and appear as their own database call returns. Changing the
// period, a filter or the tab re-keys the boundaries, so the skeletons show
// straight away instead of the old figures sitting there until every call
// is back.
//
// Overview (everyone): what needs attention now (public.overview_attention),
// the key figures, trends and work queues (public.home_dashboard and
// public.overview_extras) and the site scorecard (home_dashboard and
// public.overview_sites). Figures a role may not read are left out.
//
// System admins also get a Loggers tab (public.logger_dashboard). System
// admins and admins get a Water usage tab (public.water_target_matrix,
// public.water_borehole_matrix, public.water_usage_report, and each site's
// latest lab sample from public.lab_sample_overview). Everyone gets a
// Quality tab: lab results and on-site inspection readings against the same
// parameter limits (public.water_quality_reading).

const TABS = [
  { key: "operations", label: "Overview" },
  { key: "loggers", label: "Loggers" },
  { key: "water", label: "Water usage" },
  { key: "quality", label: "Quality" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const TAB_TITLES: Record<Tab, string> = {
  operations: "Overview",
  loggers: "Logger data",
  water: "Water usage",
  quality: "Water quality",
};

type Params = Record<string, string | string[] | undefined>;
type Supabase = Awaited<ReturnType<typeof createClient>>;
type Scope = {
  p_from: string;
  p_to: string;
  p_region_id: string | null;
  p_organisation_id: string | null;
  p_location_id: string | null;
};

function resolvePeriod(params: Params, today: string): { period: PeriodPreset; from: string; to: string } {
  const raw = typeof params.period === "string" ? params.period : DEFAULT_PERIOD;
  const period = (PERIOD_PRESETS.find((p) => p.key === raw)?.key ?? DEFAULT_PERIOD) as PeriodPreset;
  switch (period) {
    case "7d":
      return { period, from: addDays(today, -6), to: today };
    case "90d":
      return { period, from: addDays(today, -89), to: today };
    case "ytd":
      return { period, from: `${today.slice(0, 4)}-01-01`, to: today };
    case "12m":
      return { period, from: addDays(today, -364), to: today };
    case "custom": {
      const from = isYmd(params.from) ? params.from : addDays(today, -29);
      const to = isYmd(params.to) ? params.to : today;
      return from <= to ? { period, from, to } : { period, from: to, to: from };
    }
    default:
      return { period: "30d", from: addDays(today, -29), to: today };
  }
}

const uuidParam = (v: unknown) =>
  typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : "";

// One call, shared by every part that awaits it. (A Supabase query runs each
// time it is awaited, so it is turned into a plain promise first.)
const call = <T,>(query: PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>) =>
  Promise.resolve(query) as Rpc<T>;

export default async function HomePage(props: PageProps<"/admin">) {
  const supabase = await createClient();
  // The time zone doesn't depend on the role check, so they run together.
  const [roles, params, { data: tzData }] = await Promise.all([
    requireRole(["system_admin", "admin", "user", "viewer"]),
    props.searchParams,
    supabase.rpc("app_time_zone"),
  ]);

  // Logger data is readable by system admins only, water usage by system
  // admins and admins (RLS).
  const isSystemAdmin = roles.includes("system_admin");
  const tabs = TABS.filter(
    (t) =>
      t.key === "operations" ||
      t.key === "quality" ||
      isSystemAdmin ||
      (t.key === "water" && roles.includes("admin")),
  );
  const tab: Tab = tabs.find((t) => t.key === params.tab)?.key ?? "operations";

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
  const scope: Scope = {
    p_from: from,
    p_to: to,
    p_region_id: filters.region || null,
    p_organisation_id: filters.organisation || null,
    p_location_id: filters.location || null,
  };

  // The period and filters, kept when switching tabs and on links between them.
  const kept = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (k !== "tab" && k !== "qsite" && k !== "qparam" && typeof v === "string") kept.set(k, v);
  }
  const tabHref = (key: Tab) => {
    const q = new URLSearchParams(kept);
    if (key !== "operations") q.set("tab", key);
    const qs = q.toString();
    return qs ? `/admin?${qs}` : "/admin";
  };
  // New boundaries whenever what they show changes, so their skeletons show.
  const viewKey = `${tab}|${from}|${to}|${filters.region}|${filters.organisation}|${filters.location}`;

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader breadcrumb="Home" title={TAB_TITLES[tab]} />
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
      <Suspense fallback={<div className="h-[57px] print:hidden" />}>
        <Filters supabase={supabase} state={filters} today={today} tab={tab === "operations" ? undefined : tab} />
      </Suspense>

      {tab === "operations" && (
        <Overview key={viewKey} supabase={supabase} scope={scope} timeZone={timeZone} query={kept.toString()} />
      )}
      {tab !== "operations" && (
        <Suspense
          key={viewKey}
          fallback={
            <div className="flex flex-col gap-4 px-4 pt-3 pb-10 md:px-8">
              <BodySkeleton />
            </div>
          }
        >
          {tab === "quality" && <QualityTab supabase={supabase} scope={scope} params={params} />}
          {tab === "water" && (
            <WaterTab supabase={supabase} scope={scope} timeZone={timeZone} canOpenReadings={isSystemAdmin} />
          )}
          {tab === "loggers" && <LoggersTab supabase={supabase} scope={scope} timeZone={timeZone} />}
        </Suspense>
      )}
    </div>
  );
}

// The region, organisation and site lists the filters offer.
async function Filters({
  supabase,
  state,
  today,
  tab,
}: {
  supabase: Supabase;
  state: FilterState;
  today: string;
  tab?: string;
}) {
  const [regions, organisations, locations] = await Promise.all([
    supabase.from("region").select("id, name").eq("active", true).order("name"),
    supabase.from("organisation").select("id, name").eq("active", true).order("name"),
    supabase
      .from("location")
      .select("id, name, region_id, organisation_id")
      .eq("active", true)
      .eq("is_asset_manager", true)
      .order("name"),
  ]);
  return (
    <DashboardFilters
      state={state}
      today={today}
      tab={tab}
      regions={(regions.data ?? []) as FilterOption[]}
      organisations={(organisations.data ?? []) as FilterOption[]}
      locations={(locations.data ?? []) as LocationFilterOption[]}
    />
  );
}

function Overview({
  supabase,
  scope,
  timeZone,
  query,
}: {
  supabase: Supabase;
  scope: Scope;
  timeZone: string;
  query: string;
}) {
  const { p_from, p_to, ...where } = scope;
  // All four start now; each part below waits only for the ones it shows.
  const attention = call<OverviewAttention>(supabase.rpc("overview_attention", where));
  const dash = call<HomeDashboard>(supabase.rpc("home_dashboard", scope));
  const extras = call<OverviewExtras>(supabase.rpc("overview_extras", scope));
  const sites = call<OverviewSites>(supabase.rpc("overview_sites", { p_from, p_to, ...where }));

  return (
    <div className="flex flex-col gap-4 px-4 pt-3 pb-10 md:px-8">
      <Suspense fallback={<AttentionSkeleton />}>
        <AttentionStrip data={attention} query={query} />
      </Suspense>
      <Suspense fallback={<KeyFiguresSkeleton />}>
        <KeyFigures dash={dash} extras={extras} />
      </Suspense>
      <Suspense fallback={<Skeleton className="h-[420px]" />}>
        <Scorecard dash={dash} sites={sites} query={query} />
      </Suspense>
      <Suspense fallback={<BodySkeleton />}>
        <TrendsAndQueues dash={dash} extras={extras} timeZone={timeZone} />
      </Suspense>
    </div>
  );
}

function TabError({ what, error }: { what: string; error: { code?: string; message: string } | null }) {
  return (
    <div className="px-4 py-6 md:px-8">
      <LoadError what={what} error={error} />
    </div>
  );
}

async function QualityTab({ supabase, scope, params }: { supabase: Supabase; scope: Scope; params: Params }) {
  let readings;
  try {
    readings = await qualityReadings(supabase, scope);
  } catch (error) {
    return <TabError what="Water quality" error={error as { code?: string; message: string }} />;
  }
  // The trend's own pickers; the filters drop them when they change.
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (k !== "qsite" && k !== "qparam" && typeof v === "string") q.set(k, v);
  }
  const report = buildQualityReport(readings, {
    location: uuidParam(params.qsite) || undefined,
    parameter: uuidParam(params.qparam) || undefined,
  });
  return <QualityReport data={report} from={scope.p_from} to={scope.p_to} query={q.toString()} />;
}

async function WaterTab({
  supabase,
  scope,
  timeZone,
  canOpenReadings,
}: {
  supabase: Supabase;
  scope: Scope;
  timeZone: string;
  canOpenReadings: boolean;
}) {
  const [usage, matrix, boreholes, quality] = await Promise.all([
    supabase.rpc("water_usage_report", scope),
    supabase.rpc("water_target_matrix", scope),
    supabase.rpc("water_borehole_matrix", scope),
    latestSampleBySite(supabase, scope),
  ]);
  const failed = [usage, matrix, boreholes].find((r) => r.error || !r.data);
  if (failed) return <TabError what="Water usage" error={failed.error} />;
  return (
    <WaterUsageReport
      data={usage.data as WaterUsageData}
      matrix={matrix.data as WaterTargetMatrix}
      boreholes={boreholes.data as WaterBoreholeMatrix}
      timeZone={timeZone}
      canOpenReadings={canOpenReadings}
      quality={quality}
    />
  );
}

async function LoggersTab({ supabase, scope, timeZone }: { supabase: Supabase; scope: Scope; timeZone: string }) {
  const { data, error } = await supabase.rpc("logger_dashboard", scope);
  if (error || !data) return <TabError what="Logger data" error={error} />;
  return <LoggerReport data={data as LoggerDashboard} timeZone={timeZone} />;
}
