"use client";

import Link from "next/link";
import { useState } from "react";
import { bucketLabel, bucketTitle, formatDay } from "@/lib/dashboard/format";
import type { Bucket, WaterTargetLocation, WaterTargetMatrix } from "@/lib/dashboard/types";
import type { TargetBand } from "@/lib/masterdata/types";
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
  type TargetCell,
} from "./water-format";

// Home → Water usage: treated water in per location per day (or the average
// per day over a week or month), coloured by the location's own target
// bands. Figures from public.water_target_matrix(); today is never shown.

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

// Hover text: exact m³, % of target, the band, and estimated or why blank.
function cellTitle(c: TargetCell, loc: WaterTargetLocation, bucket: Bucket, avg = false): string {
  const parts = [avg ? `Average per day, ${whenText(c, "week")}` : whenText(c, bucket)];
  if (c.value === null) {
    parts.push(`No figure. ${c.reason ?? ""}`.trim());
    return parts.join(" · ");
  }
  parts.push(`${formatM3(c.value)} m³${bucket === "day" && !avg ? "" : " per day"}`);
  if (loc.target) {
    const pct = (c.value / loc.target) * 100;
    parts.push(`${pct.toFixed(1)}% of target`);
    const band = bandFor(loc.bands, pct);
    if (band) parts.push(band.label || BAND_COLOUR_LABELS[band.colour]);
  }
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

function cellStyle(c: TargetCell, loc: WaterTargetLocation) {
  if (c.value === null) return { background: BAND_STYLES.grey.bg, color: BAND_STYLES.grey.text };
  if (!loc.target) return undefined;
  const band = bandFor(loc.bands, (c.value / loc.target) * 100);
  return band ? { background: BAND_STYLES[band.colour].bg, color: BAND_STYLES[band.colour].text } : undefined;
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

function BandLegend({ bands, withLabels = false }: { bands: TargetBand[]; withLabels?: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {bandRanges(bands).map(({ band, range }) => (
        <span key={band.from_pct} className="inline-flex items-center gap-1 whitespace-nowrap">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
            style={{ background: BAND_STYLES[band.colour].swatch }}
          />
          <span className="sr-only">{BAND_COLOUR_LABELS[band.colour]}</span>
          {range}
          {withLabels && band.label && <span className="text-muted">{band.label}</span>}
        </span>
      ))}
    </span>
  );
}

export function TargetMatrix({ data, canOpenReadings }: { data: WaterTargetMatrix; canOpenReadings: boolean }) {
  const days = data.days;
  const [bucket, setBucket] = useState<Bucket>(() => defaultBucket(days.length));

  const rows = data.locations.map((loc) => ({ loc, ...targetRow(loc, days, bucket) }));
  const columns = rows[0]?.cells ?? [];

  return (
    <section className="min-w-0 rounded-card border border-border bg-card">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div className="max-w-3xl">
          <h2 className="text-[15px] font-semibold text-ink">Treated water vs target</h2>
          <p className="text-[13px] text-muted">
            Treated water in, m³{bucket === "day" ? " per day" : ` per day, averaged over each ${bucket}`}: the sum of
            each site&rsquo;s Treated Meters, coloured by its own bands as a % of its daily target. Today is left out
            until its usage is complete.
          </p>
        </div>
        {days.length > 0 && data.locations.length > 0 && (
          <div className="flex rounded-control bg-black/[.05] p-[3px]" role="group" aria-label="Show treated water">
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
      ) : data.locations.length === 0 ? (
        <Empty>No treated meters in this scope.</Empty>
      ) : (
        <>
          <div className="overflow-x-auto border-t border-border">
            <table className="w-full border-separate border-spacing-0 text-[13px]">
              <thead className="bg-table-head">
                <tr className="text-[11px] font-semibold tracking-wider text-muted uppercase">
                  <th className="sticky left-0 z-10 min-w-[150px] bg-table-head px-3 py-2 text-left font-semibold sm:min-w-[230px]">
                    Location
                  </th>
                  <th className="px-3 py-2 text-right font-semibold whitespace-nowrap" title="Daily target, m³">
                    Target
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
                  return (
                    <tr key={loc.id} className="group">
                      <td className="sticky left-0 z-10 border-t border-border bg-card px-3 py-2 align-top group-hover:bg-row-hover">
                        <div className="font-semibold text-ink">{loc.name}</div>
                        <div className="text-xs text-muted">
                          {loc.region}
                          {loc.meters > 1 && ` · ${loc.meters} treated meters`}
                        </div>
                        {loc.target !== null && loc.bands.length > 0 && !isDefaultBands(loc.bands) && (
                          <div className="mt-0.5 text-[11px] text-muted">
                            <BandLegend bands={loc.bands} />
                          </div>
                        )}
                      </td>
                      <td className="border-t border-border px-3 py-2 text-right align-top font-mono tabular-nums whitespace-nowrap group-hover:bg-row-hover">
                        {loc.target === null ? (
                          <span className="text-muted">—</span>
                        ) : (
                          Number(loc.target).toLocaleString("en-US", { maximumFractionDigits: 2 })
                        )}
                      </td>
                      {cells.map((c) => {
                        const link = href(c);
                        const title = cellTitle(c, loc, bucket);
                        return (
                          <td
                            key={c.start}
                            title={title}
                            style={cellStyle(c, loc)}
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
                        title={avg ? cellTitle(avg, loc, bucket, true) : undefined}
                        style={avg ? cellStyle(avg, loc) : undefined}
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
            <span>
              <span className="font-semibold text-ink">Default bands</span>{" "}
              <BandLegend bands={DEFAULT_TARGET_BANDS} />
            </span>
            <span>* estimated: a gap of over an hour in the readings</span>
            <span>— no figure (a treated meter without one, or under half the days)</span>
          </div>
        </>
      )}
    </section>
  );
}
