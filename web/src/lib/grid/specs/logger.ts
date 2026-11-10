import type { PullRunStatus } from "@/lib/logger-data/types";
import { LOGGER_TYPE_OPTIONS, type LoggerType } from "@/lib/masterdata/types";
import { changedFields } from "../fields";
import type { GridSpec } from "../types";

// Admin → Logger Data → Readings, one page at a time from
// logger_reading_grid. Far too many rows to count exactly on every load
// (that timed the page out at 11.7 s in prod): unfiltered, the total is the
// planner's estimate.
export const readingsGrid: GridSpec = {
  id: "logger-readings",
  view: "logger_reading_grid",
  select:
    "id, reading_at, asset_id, asset_name, asset_code, location_id, location_name, logger_type, logger_code, " +
    "value, unit, run_id, pulled_at",
  fields: [
    { key: "id", label: "ID", filter: "number" },
    { key: "time", label: "Reading time", field: "reading_at", filter: "datetime" },
    // Lookup columns filter by id; sorting by a joined name would sort every
    // reading, so they don't sort.
    {
      key: "asset",
      label: "Asset",
      field: "asset_id",
      filter: "choice",
      uuidValues: true,
      sortable: false,
      exportField: "asset_name",
    },
    { key: "code", label: "Asset code", field: "asset_code", filter: "text", sortable: false, hideable: true },
    {
      key: "location",
      label: "Location",
      field: "location_id",
      filter: "choice",
      uuidValues: true,
      sortable: false,
      hideable: true,
      exportField: "location_name",
    },
    { key: "type", label: "Logger type", field: "logger_type", filter: "choice", options: LOGGER_TYPE_OPTIONS, hideable: true, defaultHidden: true },
    { key: "logger", label: "Logger", field: "logger_code", filter: "text" },
    { key: "value", label: "Value", filter: "number" },
    { key: "unit", label: "Unit", filter: "text" },
    { key: "pulled", label: "Pulled", field: "pulled_at", filter: "datetime" },
  ],
  defaultSort: { key: "time", desc: true },
  estimateCount: true,
  changedException:
    "logger_reading has no updated_at: a re-pull overwrites a reading and nobody edits one. Sorted by reading time.",
};

export type ReadingGridRow = {
  id: number;
  reading_at: string;
  asset_id: string;
  asset_name: string | null;
  asset_code: string | null;
  location_id: string | null;
  location_name: string | null;
  logger_type: LoggerType;
  logger_code: string;
  value: number;
  unit: string | null;
  run_id: number | null;
  pulled_at: string;
};

export const RUN_STATUS_LABELS: Record<PullRunStatus, string> = {
  running: "Running",
  success: "Done",
  partial: "Some failed",
  failed: "Failed",
  no_loggers: "No loggers",
};

// Admin → Logger Data → Run log: every daily or manual pull. Changed is when
// the run last moved (finished, else started); Changed by is who asked for
// it ("System" for the daily run).
export const runsGrid: GridSpec = {
  id: "logger-runs",
  view: "logger_pull_run_grid",
  select:
    "id, trigger, logger_type, range_start, range_end, asset_count, created_at, finished_at, loggers, pending, " +
    "succeeded, failed, readings_saved, status, changed_at, changed_by, changed_by_name",
  fields: [
    { key: "id", label: "Run", filter: "number" },
    { key: "started", label: "Started", field: "created_at", filter: "datetime" },
    {
      key: "trigger",
      label: "Type",
      filter: "choice",
      options: [
        { value: "cron", label: "Daily" },
        { value: "manual", label: "Manual" },
      ],
    },
    { key: "period", label: "Period", field: "range_start", filter: "datetime", exportField: "range_start" },
    {
      key: "status",
      label: "Status",
      filter: "choice",
      // Computed per run from its results: sorting would compute them all.
      sortable: false,
      options: (Object.keys(RUN_STATUS_LABELS) as PullRunStatus[]).map((value) => ({ value, label: RUN_STATUS_LABELS[value] })),
    },
    { key: "loggers", label: "Loggers", filter: "number", sortable: false },
    { key: "failed", label: "Failed", filter: "number", sortable: false },
    { key: "readings", label: "Readings", field: "readings_saved", filter: "number", sortable: false },
    { key: "finished", label: "Finished", field: "finished_at", filter: "datetime", hideable: true, defaultHidden: true },
    ...changedFields(),
  ],
  defaultSort: { key: "changed", desc: true },
};

export type RunGridRow = {
  id: number;
  trigger: "cron" | "manual";
  logger_type: LoggerType;
  range_start: string;
  range_end: string;
  asset_count: number | null;
  created_at: string;
  finished_at: string | null;
  loggers: number;
  pending: number;
  succeeded: number;
  failed: number;
  readings_saved: number;
  status: PullRunStatus;
  changed_at: string;
  changed_by: string | null;
  changed_by_name: string | null;
};
