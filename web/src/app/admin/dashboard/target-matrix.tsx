"use client";

import Link from "next/link";
import { useState, type CSSProperties, type ReactNode } from "react";
import { bucketLabel, bucketTitle, formatDay } from "@/lib/dashboard/format";
import type {
  Bucket,
  WaterBoreholeLocation,
  WaterBoreholeMatrix,
  WaterTargetLocation,
  WaterTargetMatrix,
} from "@/lib/dashboard/types";
import type { TargetBand, TargetBandColour } from "@/lib/masterdata/types";
import { Empty } from "./cards";
import { readingsHref } from "./logger-format";
import {
  BAND_COLOUR_LABELS,
  BAND_STYLES,
  DEFAULT_TARGET_BANDS,
  bandFor,
  bandRanges,
  bucketStart,
  defaultBucket,
  formatM3,
  isDefaultBands,
  targetRow,
  type MatrixSeries,
  type TargetCell,
} from "./water-format";

// Home → Water usage: a site's water per day (or the average per day over a
// week or month), against a daily figure of its own. Two cards share it:
// Treated water vs target (public.water_target_matrix(), coloured by the
// site's target bands) and Borehole usage vs limit
// (public.water_borehole_matrix(), green at or below the limit, red above).
// Today is never shown.

const BUCKETS: { key: Bucket; label: string }[] = [
  { key: "day", label: "Daily" },
  { key: "week", label: "Weekly" },
  { key: "month", label: "Monthly" },
];

const chipClass = (on: boolean) =>
  `h-[30px] rounded-[6px] px-3 text-[13px] font-medium whitespace-nowrap transition-colors ${
    on ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink"
  }`;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const weekday = (ymd: string) => WEEKDAYS[new Date(`${ymd}T00:00:00Z`).getUTCDay()];

const whenText = (c: TargetCell, bucket: Bucket) =>
  bucket === "day"
    ? `${weekday(c.start)} ${formatDay(c.start)}`
    : c.start === c.end
      ? formatDay(c.start)
      : `${formatDay(c.start, false)} – ${formatDay(c.end)}`;

const bandStyle = (colour: TargetBandColour): CSSProperties => ({
  background: BAND_STYLES[colour].bg,
  color: BAND_STYLES[colour].text,
});

type MatrixLocation = MatrixSeries & { id: string; name: string; region: string; meters: number; meter_ids: string[] };

// What a card compares its sites against.
type Rule<L> = {
  // The site's daily figure (target or limit), m³; null = none.
  figure: (loc: L) => number | null;
  // Hover text after the m³: % of the figure, the band, or why uncoloured.
  notes: (value: number, loc: L, perDay: boolean) => string[];
  // The band colour of a value; null = uncoloured.
  colour: (value: number, loc: L) => TargetBandColour | null;
};

// Hover text: exact m³, the rule's notes, and estimated or why blank.
function cellTitle<L>(c: TargetCell, loc: L, rule: Rule<L>, bucket: Bucket, avg = false): string {
  const parts = [avg ? `Average per day, ${whenText(c, "week")}` : whenText(c, bucket)];
  if (c.value === null) {
    parts.push(`No figure. ${c.reason ?? ""}`.trim());
    return parts.join(" · ");
  }
  const perDay = bucket !== "day" || avg;
  parts.push(`${formatM3(c.value)} m³${perDay ? " per day" : ""}`);
  parts.push(...rule.notes(c.value, loc, perDay));
  if (c.start === c.end) {
    if (c.estimated) parts.push("estimated (a gap in readings over an hour)");
  } else {
    parts.push(
      `over ${c.known} ${c.known === 1 ? "day" : "days"} with a figure` +
        (c.estimatedDays ? `, ${c.estimatedDays} estimated` : ""),
    );
  }
  return parts.join(" · ");
}

function cellStyle<L>(c: TargetCell, loc: L, rule: Rule<L>): CSSProperties | undefined {
  if (c.value === null) return bandStyle("grey");
  const colour = rule.colour(c.value, loc);
  return colour ? bandStyle(colour) : undefined;
}

function Value({ c }: { c: TargetCell }) {
  if (c.value === null) return <>—</>;
  return (
    <>
      {Math.round(c.value).toLocaleString("en-US")}
      <span className="inline-block w-[0.6em] text-left">{c.estimated ? "*" : ""}</span>
    </>
  );
}

function Swatch({ colour }: { colour: TargetBandColour }) {
  return (
    <>
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
        style={{ background: BAND_STYLES[colour].swatch }}
      />
      <span className="sr-only">{BAND_COLOUR_LABELS[colour]}</span>
    </>
  );
}

function BandLegend({ bands, withLabels = false }: { bands: TargetBand[]; withLabels?: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {bandRanges(bands).map(({ band, range }) => (
        <span key={band.from_pct} className="inline-flex items-center gap-1 whitespace-nowrap">
          <Swatch colour={band.colour} />
          {range}
          {withLabels && band.label && <span className="text-muted">{band.label}</span>}
        </span>
      ))}
    </span>
  );
}

function UsageMatrix<L extends MatrixLocation>({
  days,
  locations,
  rule,
  canOpenReadings,
  title,
  description,
  empty,
  meter,
  figureLabel,
  figureTitle,
  rowNote,
  figureCellTitle,
  legend,
  noFigure,
}: {
  days: string[];
  locations: L[];
  rule: Rule<L>;
  canOpenReadings: boolean;
  title: string;
  description: (bucket: Bucket) => ReactNode;
  // Shown when the scope has no sites with this meter type.
  empty: string;
  // The meter summed, singular: "treated meter".
  meter: string;
  // The second column: "Target", and its header hover text.
  figureLabel: string;
  figureTitle: string;
  // Under the site's name, e.g. its own bands.
  rowNote?: (loc: L) => ReactNode;
  // Hover text on the second column.
  figureCellTitle?: (loc: L) => string | undefined;
  legend: ReactNode;
  // The footer's note on blank cells.
  noFigure: string;
}) {
  const [bucket, setBucket] = useState<Bucket>(() => defaultBucket(days.length));

  const rows = locations.map((loc) => ({ loc, ...targetRow(loc, days, bucket, meter) }));
  const columns = rows[0]?.cells ?? [];

  return (
    <section className="min-w-0 rounded-card border border-border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div className="max-w-3xl">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          <p className="text-[13px] text-muted">{description(bucket)}</p>
        </div>
        {days.length > 0 && locations.length > 0 && (
          <div className="flex rounded-control bg-black/[.05] p-[3px]" role="group" aria-label={`Show ${title}`}>
            {BUCKETS.map((b) => (
              <button
                key={b.key}
                type="button"
                aria-pressed={bucket === b.key}
                className={chipClass(bucket === b.key)}
                onClick={() => setBucket(b.key)}
              >
                {b.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {days.length === 0 ? (
        <Empty>No complete days in this period.</Empty>
      ) : locations.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        <>
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full border-separate border-spacing-0 text-[13px]">
              <thead className="bg-table-head">
                <tr className="text-[11px] font-semibold tracking-wider text-muted uppercase">
                  <th className="sticky left-0 z-10 min-w-[150px] bg-table-head px-3 py-2 text-left font-semibold sm:min-w-[230px]">
                    Location
                  </th>
                  <th className="px-3 py-2 text-right font-semibold whitespace-nowrap" title={figureTitle}>
                    {figureLabel}
                  </th>
                  {columns.map((c) => {
                    const start = bucketStart(c.start, bucket);
                    return (
                      <th
                        key={c.start}
                        title={bucket === "day" ? `${weekday(c.start)} ${formatDay(c.start)}` : bucketTitle(start, bucket)}
                        className="px-2 py-2 text-right font-semibold whitespace-nowrap normal-case"
                      >
                        {bucket === "day" ? (
                          <>
                            <span className="block text-[10px] tracking-wider uppercase">{weekday(c.start)}</span>
                            <span className="block text-[12px] tracking-normal">{formatDay(c.start, false)}</span>
                          </>
                        ) : (
                          <span className="block text-[12px] tracking-normal">{bucketLabel(start, bucket)}</span>
                        )}
                      </th>
                    );
                  })}
                  <th
                    className="border-l border-border px-3 py-2 text-right font-semibold whitespace-nowrap"
                    title="Average per day over the period's days with a figure"
                  >
                    Avg / day
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ loc, cells, avg }) => {
                  const href = (c: TargetCell) =>
                    canOpenReadings && loc.meter_ids[0] ? readingsHref(loc.meter_ids[0], c.start, c.end) : null;
                  const figure = rule.figure(loc);
                  return (
                    <tr key={loc.id} className="group">
                      <td className="sticky left-0 z-10 border-t border-border bg-card px-3 py-2 align-top group-hover:bg-row-hover">
                        <div className="font-semibold text-ink">{loc.name}</div>
                        <div className="text-xs text-muted">
                          {loc.region}
                          {loc.meters > 1 && ` · ${loc.meters} ${meter}s`}
                        </div>
                        {rowNote?.(loc)}
                      </td>
                      <td
                        title={figureCellTitle?.(loc)}
                        className="border-t border-border px-3 py-2 text-right align-top font-mono tabular-nums whitespace-nowrap group-hover:bg-row-hover"
                      >
                        {figure === null ? (
                          <span className="text-muted">—</span>
                        ) : (
                          Number(figure).toLocaleString("en-US", { maximumFractionDigits: 2 })
                        )}
                      </td>
                      {cells.map((c) => {
                        const link = href(c);
                        const title = cellTitle(c, loc, rule, bucket);
                        return (
                          <td
                            key={c.start}
                            title={title}
                            style={cellStyle(c, loc, rule)}
                            className="border-t border-l border-white px-2 py-2 text-right align-top font-mono tabular-nums whitespace-nowrap"
                          >
                            {link ? (
                              <Link href={link} aria-label={title} className="hover:underline">
                                <Value c={c} />
                              </Link>
                            ) : (
                              <Value c={c} />
                            )}
                          </td>
                        );
                      })}
                      <td
                        title={avg ? cellTitle(avg, loc, rule, bucket, true) : undefined}
                        style={avg ? cellStyle(avg, loc, rule) : undefined}
                        className="border-t border-l border-border px-3 py-2 text-right align-top font-mono font-semibold tabular-nums whitespace-nowrap"
                      >
                        {avg && <Value c={avg} />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-border px-5 py-3 text-xs text-muted">
            {legend}
            <span>* estimated: a gap of over an hour in the readings</span>
            <span>{noFigure}</span>
          </div>
        </>
      )}
    </section>
  );
}

// ---- Treated water vs target -----------------------------------------------

const TARGET_RULE: Rule<WaterTargetLocation> = {
  figure: (loc) => loc.target,
  notes: (value, loc) => {
    if (!loc.target) return [];
    const pct = (value / loc.target) * 100;
    const band = bandFor(loc.bands, pct);
    return [`${pct.toFixed(1)}% of target`, ...(band ? [band.label || BAND_COLOUR_LABELS[band.colour]] : [])];
  },
  colour: (value, loc) => (loc.target ? (bandFor(loc.bands, (value / loc.target) * 100)?.colour ?? null) : null),
};

export function TargetMatrix({ data, canOpenReadings }: { data: WaterTargetMatrix; canOpenReadings: boolean }) {
  return (
    <UsageMatrix
      days={data.days}
      locations={data.locations}
      rule={TARGET_RULE}
      canOpenReadings={canOpenReadings}
      title="Treated water vs target"
      description={(bucket) => (
        <>
          Treated water in, m³{bucket === "day" ? " per day" : ` per day, averaged over each ${bucket}`}: the sum of
          each site&rsquo;s Treated Meters, coloured by its own bands as a % of its daily target. Today is left out
          until its usage is complete.
        </>
      )}
      empty="No treated meters in this scope."
      meter="treated meter"
      figureLabel="Target"
      figureTitle="Daily target, m³"
      rowNote={(loc) =>
        loc.target !== null &&
        loc.bands.length > 0 &&
        !isDefaultBands(loc.bands) && (
          <div className="mt-0.5 text-[11px] text-muted">
            <BandLegend bands={loc.bands} />
          </div>
        )
      }
      legend={
        <span>
          <span className="font-semibold text-ink">Default bands</span> <BandLegend bands={DEFAULT_TARGET_BANDS} />
        </span>
      }
      noFigure="— no figure (a treated meter without one, or under half the days)"
    />
  );
}

// ---- Borehole usage vs limit -----------------------------------------------

const noLimitText = (loc: WaterBoreholeLocation) =>
  loc.meters === 1
    ? "No limit set on its borehole meter."
    : `No limit set on ${loc.unlimited} of ${loc.meters} borehole meters.`;

const LIMIT_RULE: Rule<WaterBoreholeLocation> = {
  figure: (loc) => loc.limit,
  notes: (value, loc, perDay) => {
    if (!loc.limit) return [noLimitText(loc)];
    const over = value - loc.limit;
    return [
      `${((value / loc.limit) * 100).toFixed(1)}% of limit`,
      over > 0 ? `Over limit by ${formatM3(over)} m³${perDay ? " per day" : ""}` : "Within limit",
    ];
  },
  colour: (value, loc) => (loc.limit ? (value <= loc.limit ? "green" : "red") : null),
};

export function BoreholeMatrix({ data, canOpenReadings }: { data: WaterBoreholeMatrix; canOpenReadings: boolean }) {
  return (
    <UsageMatrix
      days={data.days}
      locations={data.locations}
      rule={LIMIT_RULE}
      canOpenReadings={canOpenReadings}
      title="Borehole usage vs limit"
      description={(bucket) => (
        <>
          Borehole water abstracted, m³{bucket === "day" ? " per day" : ` per day, averaged over each ${bucket}`}: the
          sum of each site&rsquo;s Borehole Meters, against the sum of their daily usage limits. Today is left out
          until its usage is complete.
        </>
      )}
      empty="No borehole meters in this scope."
      meter="borehole meter"
      figureLabel="Limit"
      figureTitle="Daily usage limit, m³"
      figureCellTitle={(loc) => (loc.limit === null ? noLimitText(loc) : undefined)}
      legend={
        <>
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <Swatch colour="green" />
            at or below limit
          </span>
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <Swatch colour="red" />
            over limit
          </span>
        </>
      }
      noFigure="— no figure (a borehole meter without one, or under half the days)"
    />
  );
}
