import type { Bucket, GradingBand } from "./types";

// Calendar days are `YYYY-MM-DD` strings in the app time zone; the arithmetic
// runs on UTC midnights so no local offset creeps in.
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function isYmd(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDay(ymd: string, withYear = true): string {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}${withYear ? ` ${y}` : ""}`;
}

export function formatRange(from: string, to: string): string {
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${formatDay(from, !sameYear)} – ${formatDay(to)}`;
}

// Axis label for a series bucket (its first day).
export function bucketLabel(ymd: string, bucket: Bucket): string {
  const [y, m] = ymd.split("-").map(Number);
  if (bucket === "month") return m === 1 ? `${MONTHS[0]} ${String(y).slice(2)}` : MONTHS[m - 1];
  return formatDay(ymd, false);
}

// Tooltip title for a bucket.
export function bucketTitle(ymd: string, bucket: Bucket): string {
  const [y, m] = ymd.split("-").map(Number);
  if (bucket === "month") return `${MONTHS[m - 1]} ${y}`;
  if (bucket === "week") return `Week of ${formatDay(ymd)}`;
  return formatDay(ymd);
}

export const fmt = (n: number) => n.toLocaleString("en-US");

export function pct(part: number, whole: number, digits = 0): string {
  if (!whole) return "—";
  return `${((part / whole) * 100).toFixed(digits)}%`;
}

// Bands are named by colour: a grading's name ("Good", "Low", …) and its
// colour are configured separately, so a colour name never contradicts it.
export const BAND_LABELS: Record<GradingBand, string> = {
  good: "Green",
  fair: "Yellow",
  warning: "Orange",
  critical: "Red",
};

// Validated as an ordered set on white (dataviz palette check): the four
// grading colour families, stepped so neighbours stay distinct for
// colour-blind readers. Gold is low-contrast, so every use carries labels.
export const BAND_COLOURS: Record<GradingBand | "other", string> = {
  good: "#2f9e5f",
  fair: "#d4ae1a",
  warning: "#df5d27",
  critical: "#a01d2c",
  other: "#9aa3b5",
};

export const SERIES_COLOUR = "#0a7f9e";
export const ATTENTION_COLOUR = BAND_COLOURS.warning;
