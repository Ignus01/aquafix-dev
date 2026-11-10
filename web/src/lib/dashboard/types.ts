import type { TargetBand } from "@/lib/masterdata/types";

// The meter_type key of water_usage_report(), from the asset type's
// classification: treated, borehole, or other (municipal and electrical).
export type MeterType = "treated" | "borehole" | "other";

// Shape of public.home_dashboard() (supabase/migrations/20261004120000_home_dashboard.sql).

export type GradingBand = "good" | "fair" | "warning" | "critical";
export type Bucket = "day" | "week" | "month";

export type DashboardGrading = {
  id: string;
  name: string;
  priority: number;
  colour: string | null;
  band: GradingBand | null;
  count: number;
};

export type DashboardSeriesPoint = {
  bucket: string;
  inspections: number;
  attention_inspections: number;
  good: number;
  fair: number;
  warning: number;
  critical: number;
  other: number;
  incidents: number;
  due: number;
  due_completed: number;
};

export type DashboardLocation = {
  id: string;
  name: string;
  region: string;
  organisation: string;
  assets: number;
  inspections: number;
  assets_inspected: number;
  last_inspection: string | null;
  graded: number;
  attention: number;
  attention_assets: number;
  incidents: number;
  open_incidents: number;
  grading: { name: string; colour: string | null; band: GradingBand | null } | null;
};

export type DashboardOpenIncident = {
  reference: number;
  location: string;
  type: string;
  status: "new" | "in_progress";
  incident_date: string;
  comment: string;
};

export type DashboardOverdueInstruction = {
  legacy_uid: number;
  name: string;
  status: "new" | "in_progress";
  required_completed_date: string;
  nr_completed: number;
  nr_of_allocations: number;
  account_id: string | null;
};

export type HomeDashboard = {
  period: {
    from: string;
    to: string;
    days: number;
    prev_from: string;
    prev_to: string;
    bucket: Bucket;
    today: string;
    time_zone: string;
  };
  scope: { sites: number; assets: number };
  inspections: { count: number; prev: number; assets_inspected: number; inspectors: number };
  readings: {
    graded: number;
    attention: number;
    prev_graded: number;
    prev_attention: number;
    assets_graded: number;
    assets_attention: number;
  };
  incidents: {
    logged: number;
    prev_logged: number;
    open: number;
    open_new: number;
    open_in_progress: number;
    resolved: number;
    median_days: number | null;
    p90_days: number | null;
  };
  instructions: { due: number; due_completed: number; open: number; overdue: number };
  gradings: DashboardGrading[];
  series: DashboardSeriesPoint[];
  incident_types: { name: string; count: number }[];
  incident_status: { new: number; in_progress: number; completed: number };
  inspectors: { id: string; count: number }[];
  locations: DashboardLocation[];
  open_incidents: DashboardOpenIncident[];
  overdue_instructions: DashboardOverdueInstruction[];
};

export type FilterOption = { id: string; name: string };
export type LocationFilterOption = FilterOption & { region_id: string; organisation_id: string };

export const PERIOD_PRESETS = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "ytd", label: "Year to date" },
  { key: "12m", label: "12 months" },
  { key: "custom", label: "Custom" },
] as const;

export type PeriodPreset = (typeof PERIOD_PRESETS)[number]["key"];

// The period a home page URL without `period` shows.
export const DEFAULT_PERIOD: PeriodPreset = "30d";

// Shapes of the Overview functions (supabase/migrations/20261114120000_home_overview.sql).

// public.overview_attention(). A count is null when the caller's role may
// not read what it counts.
export type OverviewAttention = {
  thresholds: { incident_days: number; inspection_days: number; water_days: number; logger_hours: number };
  overdue_instructions: number;
  stale_incidents: number;
  services_overdue: number;
  uninspected_assets: number;
  lab_out_sites: number;
  borehole_over_sites: number | null;
  target_red_sites: number | null;
  silent_loggers: number | null;
  draft_invoices: number | null;
};

export type OverviewServiceQueueItem = {
  reference: number;
  asset: string;
  location: string;
  service_type: "scheduled_maintenance" | "repair";
  due_date: string;
};

// public.overview_extras(). `series` lines up with HomeDashboard.series.
export type OverviewExtras = {
  services: {
    overdue: number;
    due_soon: number;
    completed: number;
    on_time: number;
    parts: number;
    labour: number;
    prev_spend: number;
  };
  series: { bucket: string; parts: number; labour: number; closed: number }[];
  service_queue: OverviewServiceQueueItem[];
  water: { sites: number; days: number; days_on: number } | null;
  quality: { checked: number; ok: number };
  billing: { period: string; invoices: number; drafts: number; amount: number; usage: number } | null;
  assignees: Record<string, string>;
};

export type OverviewSite = {
  id: string;
  services_overdue: number;
  services_due: number;
  target: { pct: number; colour: TargetBand["colour"] | null; days: number; days_on: number } | null;
  borehole: { pct: number; days: number; days_over: number } | null;
  quality: { sample_id: string; sampled_on: string; out_of_spec: number; inconclusive: number } | null;
  loggers: number | null;
  loggers_silent: number | null;
};

// public.overview_sites().
export type OverviewSites = {
  access: { water: boolean; loggers: boolean };
  sites: OverviewSite[];
};

// Shape of public.logger_dashboard() (supabase/migrations/20261011120000_logger_dashboard.sql).

export type LoggerStatus = "ok" | "silent" | "never" | "inactive";

export type DashboardLogger = {
  id: string;
  name: string;
  code: string;
  logger_code: string | null;
  logger_type: "HYDRUS" | "DATAV8" | null;
  location: string;
  status: LoggerStatus;
  unit: string | null;
  first_at: string | null;
  last_at: string | null;
  last_value: number | null;
  readings: number;
  min: number | null;
  max: number | null;
  avg: number | null;
  stddev: number | null;
  zeros: number;
  days_with_data: number;
  days_expected: number;
  longest_gap_hours: number | null;
  prev_readings: number;
  prev_avg: number | null;
  pulls_succeeded: number;
  pulls_failed: number;
  last_error: string | null;
  // Average value per series bucket; null where the logger sent nothing.
  series: (number | null)[];
};

export type LoggerDashboard = {
  period: HomeDashboard["period"] & { last_day: string };
  scope: { loggers: number; reporting: number; ok: number; silent: number; never: number };
  readings: { count: number; prev: number; days_with_data: number; days_expected: number };
  pulls: { succeeded: number; failed: number; pending: number; loggers_failed: number };
  latest_run: {
    id: number;
    created_at: string;
    range_end: string;
    status: "running" | "success" | "partial" | "failed" | "no_loggers";
    loggers: number;
    succeeded: number;
    failed: number;
    readings_saved: number;
  } | null;
  series: { bucket: string; readings: number; loggers: number }[];
  loggers: DashboardLogger[];
};

// Shape of public.water_usage_report() (supabase/migrations/20261012120000_water_usage.sql).

export type WaterMeter = {
  id: string;
  name: string;
  code: string;
  logger_code: string | null;
  active: boolean;
  // From the asset type's classification. Null = the type isn't a meter
  // type, so the meter is left out of the target and borehole views.
  meter_type: MeterType | null;
  location_id: string;
  location: string;
  region: string;
  organisation: string;
  // The meter's first day with usage, ever.
  first_day: string;
  // m³ per day from period.first_day to period.last_day; null = no figure.
  usage: (number | null)[];
  // One character per day: o ok, e estimated, g long gap, r reset, - none.
  status: string;
};

export type WaterUsageIssue = {
  asset_id: string;
  kind: "duplicate" | "excursion" | "reset";
  from_at: string;
  to_at: string;
  readings: number;
  low: number | null;
  high: number | null;
  fell_back_to: number | null;
};

export type WaterUsageReport = {
  period: { from: string; to: string; first_day: string | null; last_day: string | null; today: string };
  meters: WaterMeter[];
  excluded: {
    id: string;
    name: string;
    code: string;
    location: string;
    unit: string | null;
    reason: "no_readings" | "not_volume";
  }[];
  issues: WaterUsageIssue[];
};

// Shape of public.water_target_matrix() (supabase/migrations/20261014120000_volume_target.sql).

export type WaterTargetLocation = {
  id: string;
  name: string;
  region: string;
  // m³ per day; null = no target.
  target: number | null;
  // Highest from_pct first.
  bands: TargetBand[];
  // Treated meters counted, and their ids by name.
  meters: number;
  meter_ids: string[];
  // Treated water in per day, m³; null = no figure.
  usage: (number | null)[];
  // One character per day: o ok, e estimated, g long gap, r reset, - none.
  status: string;
};

export type WaterTargetMatrix = {
  // From the period's start to the earlier of its end and yesterday.
  days: string[];
  locations: WaterTargetLocation[];
};

// Shape of public.water_borehole_matrix() (supabase/migrations/20261015120000_borehole_usage_limit.sql).

export type WaterBoreholeLocation = {
  id: string;
  name: string;
  region: string;
  // m³ per day, the sum of its borehole meters' limits; null when any has none.
  limit: number | null;
  // Borehole meters counted, their ids by name, and how many have no limit.
  meters: number;
  meter_ids: string[];
  unlimited: number;
  // Borehole usage per day, m³; null = no figure.
  usage: (number | null)[];
  // One character per day: o ok, e estimated, g long gap, r reset, - none.
  status: string;
};

export type WaterBoreholeMatrix = {
  // From the period's start to the earlier of its end and yesterday.
  days: string[];
  locations: WaterBoreholeLocation[];
};
