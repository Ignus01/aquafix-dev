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
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "ytd", label: "Year to date" },
  { key: "12m", label: "12 months" },
  { key: "custom", label: "Custom" },
] as const;

export type PeriodPreset = (typeof PERIOD_PRESETS)[number]["key"];

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
