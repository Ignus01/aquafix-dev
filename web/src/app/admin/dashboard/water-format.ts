import { addDays, formatDay } from "@/lib/dashboard/format";
import type { Bucket, WaterMeter, WaterTargetLocation } from "@/lib/dashboard/types";
import type { MeterType, TargetBand, TargetBandColour } from "@/lib/masterdata/types";

// Figures shared by the Water usage tab's cards, charts and table, and the
// Location form's target bands.

// Colour follows the meter type, the same on every card. Validated as a set
// on white (dataviz palette check) and kept clear of the status colours.
export const METER_COLOURS: Record<MeterType | "unset", string> = {
  treated: "#0a7f9e",
  borehole: "#7650c8",
  other: "#c2417a",
  unset: "#9aa3b5",
};

export const meterColour = (type: MeterType | null) => METER_COLOURS[type ?? "unset"];

// ---- Volume target bands ---------------------------------------------------

// Pre-filled when a location first gets a target.
export const DEFAULT_TARGET_BANDS: TargetBand[] = [
  { from_pct: 110, colour: "blue", label: "Above target" },
  { from_pct: 90, colour: "green", label: "On target" },
  { from_pct: 80, colour: "orange", label: "Below target" },
  { from_pct: 0, colour: "red", label: "Well below target" },
];

export const MAX_TARGET_BANDS = 6;

export const BAND_COLOUR_LABELS: Record<TargetBandColour, string> = {
  blue: "Blue",
  green: "Green",
  orange: "Orange",
  red: "Red",
  grey: "Grey",
};

// Cell tint and text per band colour: each pair has a contrast of at least
// 7:1, and the tints stay pale so they don't read as the chart's meter
// colours. `swatch` is the stronger colour for legends and the editor.
export const BAND_STYLES: Record<TargetBandColour, { bg: string; text: string; swatch: string }> = {
  blue: { bg: "#dbe8fb", text: "#173a7a", swatch: "#3b6fd4" },
  green: { bg: "#dcf3e3", text: "#16502e", swatch: "#2f9e5f" },
  orange: { bg: "#fde7d3", text: "#7a3410", swatch: "#df7a27" },
  red: { bg: "#fbe0e0", text: "#7d1a22", swatch: "#c8323f" },
  grey: { bg: "#eceff4", text: "#3d4458", swatch: "#9aa3b5" },
};

const pctText = (n: number) => `${Number(n.toFixed(2))}%`;

// Highest From first (the order bands are listed and stored in).
export const sortBands = (bands: TargetBand[]) => [...bands].sort((a, b) => b.from_pct - a.from_pct);

// The band a % of target falls in: the highest From at or below it.
export function bandFor(bands: TargetBand[], pct: number): TargetBand | null {
  return sortBands(bands).find((b) => pct >= b.from_pct) ?? null;
}

// Each band's range, highest first: "≥ 110%", "90–110%", "< 80%".
export function bandRanges(bands: TargetBand[]): { band: TargetBand; range: string }[] {
  const sorted = sortBands(bands);
  return sorted.map((band, i) => {
    const upper = sorted[i - 1]?.from_pct;
    const range =
      upper === undefined
        ? band.from_pct === 0
          ? "Any %"
          : `≥ ${pctText(band.from_pct)}`
        : band.from_pct === 0
          ? `< ${pctText(upper)}`
          : `${Number(band.from_pct.toFixed(2))}–${pctText(upper)}`;
    return { band, range };
  });
}

// "≥ 110% blue · 90–110% green · 80–90% orange · < 80% red"
export const bandSummary = (bands: TargetBand[]) =>
  bandRanges(bands)
    .map(({ band, range }) => `${range} ${BAND_COLOUR_LABELS[band.colour].toLowerCase()}`)
    .join(" · ");

export const isDefaultBands = (bands: TargetBand[]) => {
  const a = sortBands(bands);
  return (
    a.length === DEFAULT_TARGET_BANDS.length &&
    a.every((b, i) => b.from_pct === DEFAULT_TARGET_BANDS[i].from_pct && b.colour === DEFAULT_TARGET_BANDS[i].colour)
  );
};

// Bands as the Location form carries them: a JSON string.
export function parseBands(json: string | undefined): TargetBand[] {
  if (!json) return [];
  try {
    const list = JSON.parse(json);
    return Array.isArray(list)
      ? list.map((b) => ({
          from_pct: b?.from_pct === "" || b?.from_pct === null ? NaN : Number(b?.from_pct),
          colour: b?.colour,
          label: typeof b?.label === "string" ? b.label : null,
        }))
      : [];
  } catch {
    return [];
  }
}

// Why a target's bands can't be saved, or null. The database checks the same.
export function targetBandsError(bands: TargetBand[]): string | null {
  if (bands.length === 0) return "Add colour bands for the target.";
  if (bands.length > MAX_TARGET_BANDS) return `A location can have at most ${MAX_TARGET_BANDS} colour bands.`;
  if (bands.some((b) => !Number.isFinite(b.from_pct) || b.from_pct < 0 || b.from_pct >= 10000 || !b.colour)) {
    return "Each colour band needs a From of 0% or more and a colour.";
  }
  if (!bands.some((b) => b.from_pct === 0)) return "Add a colour band from 0%, so every value has a colour.";
  const froms = bands.map((b) => Math.round(b.from_pct * 100));
  if (new Set(froms).size < froms.length) return "Two colour bands start at the same %.";
  return null;
}

// ---- Treated water vs target -----------------------------------------------

export type TargetCell = {
  start: string;
  end: string;
  // m³ per day (a bucket's average per day); null = no figure.
  value: number | null;
  estimated: boolean;
  // Days with a figure, and how many of them are estimated.
  known: number;
  estimatedDays: number;
  // Why there is no figure.
  reason: string | null;
};

// A location's figure over some of the matrix's days: the day itself, or
// the average per day over the days with a figure, blank when under half
// the days have one.
function targetCell(loc: WaterTargetLocation, days: string[], idx: number[]): TargetCell {
  const start = days[idx[0]];
  const end = days[idx[idx.length - 1]];
  if (idx.length === 1) {
    const i = idx[0];
    const s = loc.status[i];
    const known = loc.usage[i] === null || loc.usage[i] === undefined ? 0 : 1;
    return {
      start,
      end,
      value: loc.usage[i] ?? null,
      estimated: isEstimated(s),
      known,
      estimatedDays: known && isEstimated(s) ? 1 : 0,
      reason:
        loc.usage[i] !== null && loc.usage[i] !== undefined
          ? null
          : s === "r"
            ? "A treated meter was reset that day."
            : "A treated meter has no figure for that day.",
    };
  }
  let total = 0;
  let known = 0;
  let estimatedDays = 0;
  for (const i of idx) {
    const u = loc.usage[i];
    if (u === null || u === undefined) continue;
    total += u;
    known++;
    if (isEstimated(loc.status[i])) estimatedDays++;
  }
  const enough = known > 0 && known * 2 >= idx.length;
  return {
    start,
    end,
    value: enough ? total / known : null,
    estimated: enough && estimatedDays > 0,
    known,
    estimatedDays,
    reason: enough ? null : `Only ${known} of ${idx.length} days have a figure.`,
  };
}

// One cell per bucket of the matrix's days, and the average per day over
// the whole period.
export function targetRow(
  loc: WaterTargetLocation,
  days: string[],
  bucket: Bucket,
): { cells: TargetCell[]; avg: TargetCell | null } {
  const groups: number[][] = [];
  days.forEach((day, i) => {
    const last = groups[groups.length - 1];
    if (last && bucketStart(days[last[0]], bucket) === bucketStart(day, bucket)) last.push(i);
    else groups.push([i]);
  });
  return {
    cells: groups.map((g) => targetCell(loc, days, g)),
    avg: days.length ? targetCell(loc, days, days.map((_, i) => i)) : null,
  };
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
