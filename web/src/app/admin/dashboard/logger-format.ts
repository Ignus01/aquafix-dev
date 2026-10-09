import { BAND_COLOURS } from "@/lib/dashboard/format";
import type { DashboardLogger, LoggerStatus } from "@/lib/dashboard/types";

// Formatting shared by the Loggers tab's cards and table.

export const STATUS_LABELS: Record<LoggerStatus, string> = {
  ok: "Reporting",
  silent: "Silent",
  never: "Never reported",
  inactive: "Inactive",
};

export const STATUS_COLOURS: Record<LoggerStatus, string> = {
  ok: BAND_COLOURS.good,
  silent: BAND_COLOURS.warning,
  never: BAND_COLOURS.critical,
  inactive: BAND_COLOURS.other,
};

export const formatValue = (v: number | null) =>
  v === null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: 2 });

export function formatGap(hours: number | null): string {
  if (hours === null) return "—";
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${Number(hours.toFixed(1))} h`;
  return `${Number((hours / 24).toFixed(1))} d`;
}

export const completeness = (l: Pick<DashboardLogger, "days_with_data" | "days_expected">) =>
  l.days_expected > 0 ? l.days_with_data / l.days_expected : null;

// Change in the average value vs the previous period, as a fraction.
export const avgChange = (l: DashboardLogger) =>
  l.avg !== null && l.prev_avg !== null && l.prev_avg !== 0 ? (l.avg - l.prev_avg) / Math.abs(l.prev_avg) : null;

// A sensor that reports the same value over and over is likely stuck.
export const isFlat = (l: DashboardLogger) => l.readings >= 12 && (l.stddev ?? 1) === 0;

// Gaps longer than a day are worth a look; the daily pull runs every 24 h.
export const LONG_GAP_HOURS = 24;

// Readings page for one logger over the report's period.
export const readingsHref = (assetId: string, from: string, to: string) =>
  `/admin/logger-data?${new URLSearchParams({ tab: "data", asset: assetId, from: `${from}T00:00`, to: `${to}T23:59` })}`;

// `04 Oct, 23:45`, with the year only when it isn't this year.
export function shortDateTime(iso: string, timeZone: string): string {
  const d = new Date(iso);
  const year = (at: Date) => new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric" }).format(at);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "short",
    ...(year(d) === year(new Date()) ? {} : { year: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}
