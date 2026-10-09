import type { LoggerType } from "@/lib/masterdata/types";

// An asset with a logger code, for the filters and the manual pull picker.
export type LoggerAsset = {
  id: string;
  name: string;
  code: string;
  logger_code: string;
  logger_type: LoggerType;
  active: boolean;
  location_name: string | null;
};

export type LoggerReadingRow = {
  id: number;
  reading_at: string;
  value: number;
  unit: string | null;
  logger_type: LoggerType;
  logger_code: string;
  pulled_at: string;
  asset_id: string;
  asset_name: string;
  asset_code: string;
  location_name: string | null;
};

// The grid is paged on the server; this must match the shared Pagination
// bar's PAGE_SIZE (admin/data-grid.tsx).
export const READINGS_PAGE_SIZE = 20;

export const READING_SORT_KEYS = ["reading_at", "value", "unit", "logger_code", "pulled_at"] as const;
export type ReadingSortKey = (typeof READING_SORT_KEYS)[number];

// Filters as they appear in the URL. `from`/`to` are datetime-local values,
// read as wall time in the app time zone.
export type ReadingFilter = {
  asset: string;
  from: string;
  to: string;
  sort: ReadingSortKey | null;
  desc: boolean;
};

export type ChartPoint = { t: string; v: number };

export type PullRunStatus = "running" | "success" | "partial" | "failed" | "no_loggers";

export type PullRun = {
  id: number;
  trigger: "cron" | "manual";
  logger_type: LoggerType;
  range_start: string;
  range_end: string;
  requested_by_name: string | null;
  asset_count: number | null;
  created_at: string;
  finished_at: string | null;
  loggers: number;
  pending: number;
  succeeded: number;
  failed: number;
  readings_saved: number;
  status: PullRunStatus;
};

export type PullResultStatus = "pending" | "running" | "success" | "failed";

export type PullResult = {
  id: number;
  logger_code: string;
  asset_name: string | null;
  status: PullResultStatus;
  attempts: number;
  next_attempt_at: string;
  finished_at: string | null;
  readings_saved: number | null;
  unit: string | null;
  http_status: number | null;
  error: string | null;
};
