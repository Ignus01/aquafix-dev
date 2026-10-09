"use client";

import { useState } from "react";
import { bucketLabel, bucketTitle } from "@/lib/dashboard/format";
import type { Bucket } from "@/lib/dashboard/types";
import { Tooltip, useWidth, type TipRow } from "./charts";
import { formatM3, type BucketPoint } from "./water-format";

export type UsageLine = { key: string; label: string; colour: string; points: BucketPoint[] };

// A round step giving at most five intervals up to `max`.
function niceStep(max: number): number {
  if (max <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(max / 5));
  return [1, 2, 5, 10].map((f) => f * mag).find((s) => s * 5 >= max) ?? 10 * mag;
}

// Usage per bucket for a site's meters, one 2px line each. Buckets with
// estimated days get a hollow marker; buckets without a figure break the
// line. Hover (or focus) shows every meter's figure for the bucket.
export function UsageChart({
  lines,
  bucket,
  height = 220,
  ariaLabel,
}: {
  lines: UsageLine[];
  bucket: Bucket;
  height?: number;
  ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(520);
  const [active, setActive] = useState<number | null>(null);
  const starts = lines[0]?.points.map((p) => p.start) ?? [];
  const n = starts.length;

  const L = 40;
  const R = 10;
  const T = 12;
  const B = 24;
  const plotW = width - L - R;
  const plotH = height - T - B;
  const peak = Math.max(0, ...lines.flatMap((l) => l.points.map((p) => p.avg ?? 0)));
  const step = niceStep(peak);
  const max = step * Math.max(1, Math.ceil(peak / step));
  const ticks = Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step);
  const x = (i: number) => L + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const y = (v: number) => T + plotH - (v / max) * plotH;
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 56))));
  const perDay = bucket === "day" ? "m³" : "m³/day";

  const indexAt = (clientX: number, el: Element) => {
    const box = el.getBoundingClientRect();
    const px = clientX - box.left;
    return Math.max(0, Math.min(n - 1, Math.round(((px - L) / plotW) * (n - 1))));
  };

  const tipRows = (i: number): TipRow[] => {
    const rows: TipRow[] = lines.map((l) => {
      const p = l.points[i];
      const value = p.avg === null ? "no data" : `${p.estimated ? "~" : ""}${formatM3(p.avg)} ${perDay}`;
      return { label: l.label, colour: l.colour, value };
    });
    if (lines.some((l) => l.points[i].estimated > 0)) rows.push({ label: "~ includes estimated days", value: "" });
    return rows;
  };

  return (
    <div ref={ref} className="relative w-full">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={ariaLabel}
        className="block overflow-visible"
        onMouseMove={(e) => setActive(indexAt(e.clientX, e.currentTarget))}
        onMouseLeave={() => setActive(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={width - R} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#c5ccd8" : "#e8ecf2"} />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" className="fill-muted font-mono text-[11px] tabular-nums">
              {t.toLocaleString("en-US")}
            </text>
          </g>
        ))}
        {starts.map(
          (s, i) =>
            i % labelEvery === 0 && (
              <text key={s} x={x(i)} y={height - 6} textAnchor="middle" className="fill-muted text-[11px]">
                {bucketLabel(s, bucket)}
              </text>
            ),
        )}
        {active !== null && (
          <line x1={x(active)} x2={x(active)} y1={T} y2={T + plotH} stroke="#9aa3b5" strokeWidth={1} />
        )}
        {lines.map((l) => {
          let d = "";
          let pen = false;
          l.points.forEach((p, i) => {
            if (p.avg === null) {
              pen = false;
              return;
            }
            d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(p.avg).toFixed(1)}`;
            pen = true;
          });
          return (
            <g key={l.key}>
              <path d={d} fill="none" stroke={l.colour} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {/* A lone figure between gaps still needs a mark. */}
              {l.points.map((p, i) =>
                p.avg !== null && (p.estimated > 0 || ((l.points[i - 1]?.avg ?? null) === null && (l.points[i + 1]?.avg ?? null) === null)) ? (
                  <circle
                    key={p.start}
                    cx={x(i)}
                    cy={y(p.avg)}
                    r={3.5}
                    fill={p.estimated > 0 ? "#fff" : l.colour}
                    stroke={l.colour}
                    strokeWidth={2}
                  />
                ) : null,
              )}
              {active !== null && l.points[active]?.avg != null && (
                <circle cx={x(active)} cy={y(l.points[active].avg!)} r={4.5} fill={l.colour} stroke="#fff" strokeWidth={2} />
              )}
            </g>
          );
        })}
        <rect
          x={L}
          y={T}
          width={Math.max(0, plotW)}
          height={plotH}
          fill="transparent"
          tabIndex={0}
          aria-label={`${ariaLabel}. Use the arrow keys to read each ${bucket}.`}
          className="cursor-crosshair outline-none"
          onFocus={() => setActive((a) => a ?? n - 1)}
          onBlur={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? n) - 1));
            if (e.key === "ArrowRight") setActive((a) => Math.min(n - 1, (a ?? -1) + 1));
          }}
        />
      </svg>
      <Tooltip
        tip={
          active === null
            ? null
            : {
                x: x(active),
                y: T + 4,
                title: bucketTitle(starts[active], bucket),
                rows: tipRows(active),
              }
        }
        width={width}
      />
    </div>
  );
}
