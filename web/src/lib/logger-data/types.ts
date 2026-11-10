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
