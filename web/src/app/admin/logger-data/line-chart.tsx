"use client";

import { useState } from "react";
import type { ChartPoint } from "@/lib/logger-data/types";
import { Tooltip, useWidth, type Tip } from "../dashboard/charts";

// One logger's readings over time. Same marks as the dashboard kit: hairline
// grid, ink text, a tooltip on hover/focus (arrow keys step through points).
// The line breaks where readings are missing (a gap of more than 3× the
// usual interval).

const COLOUR = "#0a7f9e";

// About five round steps covering [min, max]; not anchored at zero, since a
// pressure that moves between 300 and 320 would otherwise be a flat line.
function niceTicks(min: number, max: number): number[] {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const raw = (max - min) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw) ?? 10 * mag;
  const ticks: number[] = [];
  for (let t = Math.floor(min / step) * step; t <= max + step / 2; t += step) {
    ticks.push(Number(t.toPrecision(12)));
  }
  return ticks;
}

function formatter(timeZone: string, withYear: boolean) {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "short",
    ...(withYear ? { year: "numeric" } : {}),
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return (ms: number) => f.format(new Date(ms)).replace(",", "");
}

const formatValue = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 3 });

export function LineChart({
  points,
  unit,
  timeZone,
  ariaLabel,
  height = 260,
}: {
  points: ChartPoint[];
  unit: string | null;
  timeZone: string;
  ariaLabel: string;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(720);
  const [active, setActive] = useState<number | null>(null);

  const L = 56;
  const R = 14;
  const T = 12;
  const B = 28;
  const plotW = Math.max(1, width - L - R);
  const plotH = height - T - B;

  const times = points.map((p) => Date.parse(p.t));
  const values = points.map((p) => p.v);
  const t0 = times[0] ?? 0;
  const t1 = Math.max(times[times.length - 1] ?? 0, t0 + 1);
  const ticks = niceTicks(Math.min(...values), Math.max(...values));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const x = (t: number) => L + ((t - t0) / (t1 - t0)) * plotW;
  const y = (v: number) => T + plotH - ((v - lo) / (hi - lo)) * plotH;

  const intervals = times.slice(1).map((t, i) => t - times[i]).sort((a, b) => a - b);
  const usual = intervals[Math.floor(intervals.length / 2)] ?? 0;
  const d = points
    .map((p, i) => {
      const breaks = i === 0 || (usual > 0 && times[i] - times[i - 1] > 3 * usual);
      return `${breaks ? "M" : "L"}${x(times[i]).toFixed(1)},${y(p.v).toFixed(1)}`;
    })
    .join("");

  const spansYears = new Date(t0).getUTCFullYear() !== new Date(t1).getUTCFullYear();
  const axisLabel = formatter(timeZone, spansYears);
  const tipLabel = formatter(timeZone, true);
  const xTicks = Math.max(2, Math.min(6, Math.floor(plotW / 120)));
  const unitSuffix = unit ? ` ${unit}` : "";

  // Index of the reading nearest to pixel `px` (times are ascending).
  function nearest(px: number) {
    const t = t0 + ((px - L) / plotW) * (t1 - t0);
    let a = 0;
    let b = times.length - 1;
    while (a < b) {
      const m = (a + b) >> 1;
      if (times[m] < t) a = m + 1;
      else b = m;
    }
    return a > 0 && t - times[a - 1] < times[a] - t ? a - 1 : a;
  }

  const tip: Tip | null =
    active === null
      ? null
      : {
          x: x(times[active]),
          y: y(values[active]),
          title: tipLabel(times[active]),
          rows: [{ label: "Reading", value: `${formatValue(values[active])}${unitSuffix}`, colour: COLOUR }],
        };

  return (
    <div ref={ref} className="relative w-full">
      <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block overflow-visible">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={width - R} y1={y(t)} y2={y(t)} stroke={t === lo ? "#c5ccd8" : "#e8ecf2"} />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" className="fill-muted font-mono text-[11px] tabular-nums">
              {formatValue(t)}
            </text>
          </g>
        ))}
        {Array.from({ length: xTicks }, (_, i) => t0 + ((t1 - t0) * i) / (xTicks - 1)).map((t, i) => (
          <text
            key={t}
            x={x(t)}
            y={height - 6}
            textAnchor={i === 0 ? "start" : i === xTicks - 1 ? "end" : "middle"}
            className="fill-muted text-[11px]"
          >
            {axisLabel(t)}
          </text>
        ))}

        <path d={d} fill="none" stroke={COLOUR} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {points.length === 1 && <circle cx={x(times[0])} cy={y(values[0])} r={3} fill={COLOUR} />}

        {active !== null && (
          <g pointerEvents="none">
            <line x1={x(times[active])} x2={x(times[active])} y1={T} y2={T + plotH} stroke="#c5ccd8" />
            <circle cx={x(times[active])} cy={y(values[active])} r={4} fill={COLOUR} stroke="#fff" strokeWidth={2} />
          </g>
        )}

        <rect
          x={L}
          y={T}
          width={plotW}
          height={plotH}
          fill="transparent"
          tabIndex={0}
          aria-label={`${ariaLabel}. Use the arrow keys to step through readings.`}
          className="cursor-crosshair outline-none"
          onMouseMove={(e) => {
            const box = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
            if (box) setActive(nearest(e.clientX - box.left));
          }}
          onMouseLeave={() => setActive(null)}
          onFocus={() => setActive(points.length - 1)}
          onBlur={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            const step = e.key === "ArrowLeft" ? -1 : 1;
            setActive((i) => Math.min(points.length - 1, Math.max(0, (i ?? points.length - 1) + step)));
          }}
        />
      </svg>
      <Tooltip tip={tip} width={width} />
    </div>
  );
}
