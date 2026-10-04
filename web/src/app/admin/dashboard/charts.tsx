"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

// Small dependency-free chart kit for the home dashboard. Marks follow one
// spec: bars ≤ 24px with a 4px rounded data-end and a square baseline, 2px
// surface gaps between stacked segments, hairline grid, text in ink tokens
// (never the series colour), a hover/focus tooltip on every mark.

function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(160, Math.floor(entry.contentRect.width)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

const fmt = (n: number) => n.toLocaleString("en-US");

// 0 plus four clean steps covering `max`.
function niceScale(max: number): number[] {
  if (max <= 0) return [0, 1, 2, 3, 4];
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((f) => f * mag).find((s) => s >= raw) ?? 10 * mag;
  const unit = step < 1 ? 1 : step; // counts are whole numbers
  return [0, 1, 2, 3, 4].map((i) => i * unit);
}

// Rect with rounded top corners only (the data-end); square at the baseline.
function columnPath(x: number, yTop: number, w: number, yBase: number, rounded: boolean) {
  const h = yBase - yTop;
  const r = rounded ? Math.min(4, h, w / 2) : 0;
  return `M${x},${yBase}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + w - r}Q${x + w},${yTop} ${x + w},${yTop + r}V${yBase}Z`;
}

type TipRow = { label: string; value: string; colour?: string };
type Tip = { x: number; y: number; title: string; rows: TipRow[] };

function Tooltip({ tip, width }: { tip: Tip | null; width: number }) {
  if (!tip) return null;
  const boxWidth = 196;
  const left = Math.min(Math.max(tip.x - boxWidth / 2, 0), Math.max(0, width - boxWidth));
  return (
    <div
      role="status"
      className="pointer-events-none absolute z-10 rounded-control bg-ink px-3 py-2 text-xs leading-relaxed text-white shadow-lg"
      style={{ left, top: Math.max(tip.y - 8, 0), width: boxWidth, transform: "translateY(-100%)" }}
    >
      <div className="mb-1 font-semibold">{tip.title}</div>
      {tip.rows.map((row) => (
        <div key={row.label} className="flex items-center gap-2">
          {row.colour && (
            <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ background: row.colour }} />
          )}
          <span className="flex-1 text-white/75">{row.label}</span>
          <span className="font-mono tabular-nums">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

export type ColumnSeries = { key: string; label: string; colour: string };
export type ColumnDatum = {
  label: string;
  title: string;
  values: Record<string, number>;
  // Extra tooltip lines (e.g. the counts behind a rate).
  extra?: { label: string; value: string }[];
};

// Single or stacked columns on one axis. `percent` normalises each stack to
// 100%. `labelPeak` writes the total on the highest and the latest column.
export function ColumnChart({
  data,
  series,
  height = 220,
  percent = false,
  labelPeak = false,
  unit = "count",
  ariaLabel,
}: {
  data: ColumnDatum[];
  series: ColumnSeries[];
  height?: number;
  percent?: boolean;
  labelPeak?: boolean;
  // What the values are, for ticks, labels and tooltips (`percent` aside).
  unit?: "count" | "percent";
  ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(560);
  const format = unit === "percent" ? (n: number) => `${Number(n.toFixed(1))}%` : fmt;
  const [active, setActive] = useState<number | null>(null);

  const L = 40;
  const R = 6;
  const T = 18;
  const B = 24;
  const plotW = width - L - R;
  const plotH = height - T - B;
  const totals = data.map((d) => series.reduce((sum, s) => sum + (d.values[s.key] ?? 0), 0));
  const ticks = percent ? [0, 25, 50, 75, 100] : niceScale(Math.max(0, ...totals));
  const max = ticks[ticks.length - 1] || 1;
  const band = data.length ? plotW / data.length : plotW;
  const barW = Math.max(2, Math.min(24, band * 0.62));
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(plotW / 52))));
  const y = (v: number) => T + plotH - (v / max) * plotH;

  const peak = totals.indexOf(Math.max(...totals));
  const labelled = new Set(labelPeak && !percent ? [peak, data.length - 1] : []);

  const tipFor = (i: number): Tip => {
    const d = data[i];
    const total = totals[i];
    const rows: TipRow[] = [...series].reverse().map((s) => {
      const v = d.values[s.key] ?? 0;
      return {
        label: s.label,
        colour: s.colour,
        value: percent ? `${total ? Math.round((v / total) * 100) : 0}% · ${fmt(v)}` : format(v),
      };
    });
    if (series.length > 1 && !percent) rows.push({ label: "Total", value: format(total) });
    if (percent) rows.push({ label: "Total", value: fmt(total) });
    rows.push(...(d.extra ?? []));
    return { x: L + band * i + band / 2, y: y(percent ? (total ? 100 : 0) : total), title: d.title, rows };
  };

  return (
    <div ref={ref} className="relative w-full">
      <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block overflow-visible">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={width - R} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#c5ccd8" : "#e8ecf2"} />
            <text x={L - 8} y={y(t) + 4} textAnchor="end" className="fill-muted font-mono text-[11px] tabular-nums">
              {percent ? `${t}%` : format(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const total = totals[i];
          const x = L + band * i + (band - barW) / 2;
          let acc = 0;
          const visible = series.filter((s) => (d.values[s.key] ?? 0) > 0);
          return (
            <g
              key={d.title}
              opacity={active === null || active === i ? 1 : 0.45}
              className="transition-opacity"
            >
              {visible.map((s, si) => {
                const raw = d.values[s.key] ?? 0;
                const v = percent ? (total ? (raw / total) * 100 : 0) : raw;
                const base = y(acc);
                acc += v;
                const top = y(acc);
                const yBase = si === 0 ? base : base - 2; // 2px surface gap
                if (yBase - top < 0.5) return null;
                return (
                  <path
                    key={s.key}
                    d={columnPath(x, top, barW, yBase, si === visible.length - 1)}
                    fill={s.colour}
                  />
                );
              })}
              {labelled.has(i) && total > 0 && (
                <text
                  x={x + barW / 2}
                  y={y(total) - 6}
                  textAnchor="middle"
                  className="fill-ink font-mono text-[11px] tabular-nums"
                >
                  {format(total)}
                </text>
              )}
              {i % labelEvery === 0 && (
                <text x={L + band * i + band / 2} y={height - 6} textAnchor="middle" className="fill-muted text-[11px]">
                  {d.label}
                </text>
              )}
              <rect
                x={L + band * i}
                y={T}
                width={band}
                height={plotH}
                fill="transparent"
                tabIndex={0}
                aria-label={`${d.title}: ${percent ? fmt(total) : format(total)}`}
                className="cursor-crosshair outline-none"
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
              />
            </g>
          );
        })}
      </svg>
      <Tooltip tip={active === null ? null : tipFor(active)} width={width} />
    </div>
  );
}

// Trend line for a stat tile: the de-emphasised history with the latest point
// marked. No axis — the tile's figure carries the value.
export function Sparkline({
  values,
  colour = "#0a7f9e",
  ariaLabel,
}: {
  values: (number | null)[];
  colour?: string;
  ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>(180);
  const height = 34;
  const points = values
    .map((v, i) => (v === null ? null : { i, v }))
    .filter((p): p is { i: number; v: number } => p !== null);
  if (points.length < 2) return <div ref={ref} className="h-[34px]" />;
  const max = Math.max(...points.map((p) => p.v));
  const min = Math.min(...points.map((p) => p.v));
  const span = max - min || 1;
  const px = (i: number) => 4 + (i / Math.max(1, values.length - 1)) * (width - 8);
  const py = (v: number) => 4 + (1 - (v - min) / span) * (height - 8);
  const d = points.map((p, k) => `${k ? "L" : "M"}${px(p.i).toFixed(1)},${py(p.v).toFixed(1)}`).join("");
  const last = points[points.length - 1];
  return (
    <div ref={ref} className="h-[34px] w-full">
      <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block overflow-visible">
        <path d={d} fill="none" stroke="#b9c2d0" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={px(last.i)} cy={py(last.v)} r={4} fill={colour} stroke="#fff" strokeWidth={2} />
      </svg>
    </div>
  );
}

export type BarRow = { label: string; value: number; href?: string; note?: string };

// Ranked horizontal bars, value at the tip.
export function BarList({
  rows,
  colour = "#0a7f9e",
  format = fmt,
  max,
}: {
  rows: BarRow[];
  colour?: string;
  format?: (n: number) => string;
  max?: number;
}) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((row) => {
        const label = (
          <span className="block truncate text-[13px] text-ink" title={row.label}>
            {row.label}
          </span>
        );
        return (
          <li key={row.label} className="grid grid-cols-[minmax(0,9.5rem)_1fr] items-center gap-3">
            {row.href ? (
              <Link href={row.href} className="hover:underline">
                {label}
              </Link>
            ) : (
              label
            )}
            <div className="flex min-w-0 items-center gap-2" title={`${row.label}: ${format(row.value)}`}>
              <div
                className="h-2.5 min-w-[2px] rounded-r-[4px]"
                style={{ width: `${(row.value / top) * 100}%`, background: colour, maxWidth: "calc(100% - 3.5rem)" }}
              />
              <span className="shrink-0 font-mono text-xs text-muted tabular-nums">
                {format(row.value)}
                {row.note && <span className="ml-1 text-muted/80">{row.note}</span>}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export type Segment = { key: string; label: string; value: number; colour: string };

// One 100% bar split into parts, 2px surface gaps between them.
export function SegmentBar({ segments, ariaLabel }: { segments: Segment[]; ariaLabel: string }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const visible = segments.filter((s) => s.value > 0);
  if (!total) return <div className="h-3.5 rounded-[4px] bg-table-head" aria-label={ariaLabel} />;
  return (
    <div className="flex h-3.5 w-full gap-[2px]" role="img" aria-label={ariaLabel}>
      {visible.map((s, i) => (
        <div
          key={s.key}
          title={`${s.label}: ${fmt(s.value)} (${Math.round((s.value / total) * 100)}%)`}
          className={`h-full min-w-[3px] ${i === 0 ? "rounded-l-[4px]" : ""} ${i === visible.length - 1 ? "rounded-r-[4px]" : ""}`}
          style={{ flexGrow: s.value, flexBasis: 0, background: s.colour }}
        />
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; colour: string; value?: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: item.colour }} />
          {item.label}
          {item.value && <span className="font-mono text-ink tabular-nums">{item.value}</span>}
        </span>
      ))}
    </div>
  );
}
