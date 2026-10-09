import { addDays, formatDay } from "@/lib/dashboard/format";
import type { Bucket, WaterMeter } from "@/lib/dashboard/types";

// Figures shared by the Water usage tab's cards, charts and table.

// Colour follows the meter type, the same on every card. Validated as a set
// on white (dataviz palette check) and kept clear of the status colours.
export const METER_COLOURS = {
  treated: "#0a7f9e",
  borehole: "#7650c8",
  municipal: "#c2417a",
} as const;

export function meterColour(name: string): string {
  if (/borehole/i.test(name)) return METER_COLOURS.borehole;
  if (/municipal/i.test(name)) return METER_COLOURS.municipal;
  return METER_COLOURS.treated;
}

export const formatM3 = (v: number | null, digits = 1) =>
  v === null ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

// A day's figure: o ok, e estimated, g long gap (also estimated), r reset,
// - none.
export const isEstimated = (s: string) => s === "e" || s === "g";

export type MeterStats = {
  total: number;
  days: number;
  avg: number | null;
  peak: { day: string; usage: number } | null;
  estimated: number;
  // Days without a figure since the meter's first day.
  missing: number;
};

export function meterStats(m: WaterMeter, days: string[]): MeterStats {
  let total = 0;
  let known = 0;
  let estimated = 0;
  let missing = 0;
  let peak: MeterStats["peak"] = null;
  m.usage.forEach((u, i) => {
    if (days[i] < m.first_day) return;
    if (u === null) {
      missing++;
      return;
    }
    total += u;
    known++;
    if (isEstimated(m.status[i])) estimated++;
    if (!peak || u > peak.usage) peak = { day: days[i], usage: u };
  });
  return { total, days: known, avg: known ? total / known : null, peak, estimated, missing };
}

// The first day of the bucket a day falls in (weeks start on Monday, as in
// the database's date_trunc).
export function bucketStart(day: string, bucket: Bucket): string {
  if (bucket === "month") return `${day.slice(0, 7)}-01`;
  if (bucket === "week") {
    const weekday = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
    return addDays(day, -weekday);
  }
  return day;
}

export type BucketPoint = {
  start: string;
  // Average m³ per day over the days with a figure; null = none.
  avg: number | null;
  total: number;
  days: number;
  estimated: number;
  missing: number;
};

// A meter's usage per bucket, over the report's days.
export function bucketise(m: WaterMeter, days: string[], bucket: Bucket): BucketPoint[] {
  const points: BucketPoint[] = [];
  days.forEach((day, i) => {
    const start = bucketStart(day, bucket);
    let p = points[points.length - 1];
    if (!p || p.start !== start) {
      p = { start, avg: null, total: 0, days: 0, estimated: 0, missing: 0 };
      points.push(p);
    }
    const u = m.usage[i];
    if (u === null) {
      if (day >= m.first_day) p.missing++;
      return;
    }
    p.total += u;
    p.days++;
    if (isEstimated(m.status[i])) p.estimated++;
    p.avg = p.total / p.days;
  });
  return points;
}

export function defaultBucket(dayCount: number): Bucket {
  return dayCount <= 45 ? "day" : dayCount <= 200 ? "week" : "month";
}

// Consecutive days as compact ranges: "7–8 Sep, 14 Sep".
export function dayRanges(list: string[], limit = 6): string {
  const ranges: [string, string][] = [];
  for (const day of [...list].sort()) {
    const last = ranges[ranges.length - 1];
    if (last && addDays(last[1], 1) === day) last[1] = day;
    else ranges.push([day, day]);
  }
  const text = ranges.slice(0, limit).map(([a, b]) => {
    if (a === b) return formatDay(a, false);
    const sameMonth = a.slice(0, 7) === b.slice(0, 7);
    return sameMonth ? `${Number(a.slice(8))}–${formatDay(b, false)}` : `${formatDay(a, false)} – ${formatDay(b, false)}`;
  });
  return ranges.length > limit ? `${text.join(", ")} and ${ranges.length - limit} more` : text.join(", ");
}

export function daysFrom(first: string, last: string): string[] {
  const out: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) out.push(d);
  return out;
}
