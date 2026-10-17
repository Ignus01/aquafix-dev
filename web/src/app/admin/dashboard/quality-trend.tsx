"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formatDay } from "@/lib/dashboard/format";
import { STATUS_LABELS, formatResult, rangeText } from "@/lib/quality/evaluate";
import {
  LAB_COLOUR,
  SITE_COLOUR,
  readingTime,
  type QualityReading,
  type ReportParameter,
} from "@/lib/quality/report";
import { Tooltip, useWidth } from "./charts";
import { BAND_STYLES } from "./water-format";

const LIMIT_COLOUR = BAND_STYLES.red.swatch;

const selectClass =
  "h-[34px] min-w-0 rounded-control border border-border bg-white px-2.5 text-[13px] text-ink outline-none transition-colors focus:border-primary";

// A round step giving about four intervals over `span`.
function niceStep(span: number): number {
  if (span <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(span / 4));
  return [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s * 4 >= span) ?? 10 * mag;
}

const trim = (n: number) => Number(n.toPrecision(10)).toString();

// One parameter at one site over the period: site readings as a line, lab
// results as diamonds (hollow when below detection), the parameter's limits
// as dashed lines. Out-of-spec points get a red ring. The pickers change the
// site and parameter through the URL (`qsite`, `qparam`).
export function QualityTrend({
  points,
  parameter,
  parameters,
  locationId,
  locations,
  from,
  to,
  query,
  height = 260,
}: {
  points: QualityReading[];
  parameter: ReportParameter;
  parameters: ReportParameter[];
  locationId: string;
  locations: { id: string; name: string }[];
  from: string;
  to: string;
  // The page's other search params, kept when a picker changes.
  query: string;
  height?: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [ref, width] = useWidth<HTMLDivElement>(640);
  const [active, setActive] = useState<number | null>(null);

  function go(next: { qsite?: string; qparam?: string }) {
    const q = new URLSearchParams(query);
    q.set("qsite", next.qsite ?? locationId);
    if (next.qparam) q.set("qparam", next.qparam);
    startTransition(() => router.push(`/admin?${q.toString()}`, { scroll: false }));
  }

  const L = 48;
  const R = 64;
  const T = 14;
  const B = 26;
  const plotW = width - L - R;
  const plotH = height - T - B;

  const t0 = Date.parse(`${from}T00:00:00Z`);
  const t1 = Date.parse(`${to}T23:59:59Z`);
  const x = (t: number) => L + ((t - t0) / Math.max(1, t1 - t0)) * plotW;

  const { min_acceptable: min, max_acceptable: max } = parameter;
  const values = points.map((p) => p.value);
  let lo = Math.min(...values, ...(min !== null ? [min] : [0]), ...(max !== null ? [max] : []));
  let hi = Math.max(...values, ...(min !== null ? [min] : []), ...(max !== null ? [max] : []));
  // Concentrations don't go below 0, so the axis stops there.
  const nonNegative = lo >= 0;
  if (hi === lo) {
    hi += 1;
    lo -= 1;
  }
  const pad = (hi - lo) * 0.08;
  const step = niceStep(hi - lo + 2 * pad);
  const yMin = nonNegative && lo - pad < 0 ? 0 : Math.floor((lo - pad) / step) * step;
  const yMax = Math.ceil((hi + pad) / step) * step;
  const ticks = Array.from({ length: Math.round((yMax - yMin) / step) + 1 }, (_, i) => yMin + i * step);
  const y = (v: number) => T + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  // Month ticks along the period.
  const months: { t: number; label: string }[] = [];
  const start = new Date(t0);
  for (let d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1)); d.getTime() <= t1; d.setUTCMonth(d.getUTCMonth() + 1)) {
    months.push({ t: d.getTime(), label: formatDay(d.toISOString().slice(0, 10), d.getUTCMonth() === 0).replace(/^1 /, "") });
  }
  const monthEvery = Math.max(1, Math.ceil(months.length / Math.max(1, Math.floor(plotW / 64))));

  const site = points.map((p, i) => ({ p, i })).filter(({ p }) => p.source === "site");
  const lab = points.map((p, i) => ({ p, i })).filter(({ p }) => p.source === "lab");
  const sitePath = site
    .map(({ p }, k) => `${k ? "L" : "M"}${x(readingTime(p)).toFixed(1)},${y(p.value).toFixed(1)}`)
    .join("");

  const nearest = (clientX: number, el: Element) => {
    const px = clientX - el.getBoundingClientRect().left;
    let best: number | null = null;
    let dist = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(x(readingTime(p)) - px);
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    return dist <= 24 ? best : null;
  };

  const a = active === null ? null : points[active];
  const unit = parameter.unit;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2" aria-busy={pending}>
        <select
          aria-label="Site"
          className={`${selectClass} w-[180px]`}
          value={locationId}
          onChange={(e) => go({ qsite: e.target.value })}
        >
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Parameter"
          className={`${selectClass} w-[220px]`}
          value={parameter.id}
          onChange={(e) => go({ qparam: e.target.value })}
        >
          {parameters.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.unit !== p.name ? ` (${p.unit})` : ""} · {p.site ? `${p.site} site, ${p.lab} lab` : "lab only"}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted">Limit {rangeText(parameter)} {unit}</span>
        {pending && <span className="text-xs text-muted">Updating…</span>}
      </div>

      <div ref={ref} className="relative w-full">
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${parameter.name} at the selected site: ${site.length} site readings and ${lab.length} lab results against the limit ${rangeText(parameter)} ${unit}`}
          className="block overflow-visible"
          onMouseMove={(e) => setActive(nearest(e.clientX, e.currentTarget))}
          onMouseLeave={() => setActive(null)}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line x1={L} x2={L + plotW} y1={y(v)} y2={y(v)} stroke={v === yMin ? "#c5ccd8" : "#e8ecf2"} />
              <text x={L - 8} y={y(v) + 4} textAnchor="end" className="fill-muted font-mono text-[11px] tabular-nums">
                {trim(v)}
              </text>
            </g>
          ))}
          {months.map(
            (m, i) =>
              i % monthEvery === 0 && (
                <text key={m.t} x={x(m.t)} y={height - 6} textAnchor="middle" className="fill-muted text-[11px]">
                  {m.label}
                </text>
              ),
          )}
          {[
            { v: min, label: "min" },
            { v: max, label: "max" },
          ].map(
            (l) =>
              l.v !== null && (
                <g key={l.label}>
                  <line x1={L} x2={L + plotW} y1={y(l.v)} y2={y(l.v)} stroke={LIMIT_COLOUR} strokeWidth={1.5} strokeDasharray="6 4" />
                  <text x={L + plotW + 6} y={y(l.v) + 4} className="text-[11px]" fill={LIMIT_COLOUR}>
                    {l.label} {trim(l.v)}
                  </text>
                </g>
              ),
          )}
          {a && (
            <line x1={x(readingTime(a))} x2={x(readingTime(a))} y1={T} y2={T + plotH} stroke="#9aa3b5" strokeWidth={1} />
          )}
          <path d={sitePath} fill="none" stroke={SITE_COLOUR} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {site.map(({ p, i }) => {
            const out = p.status === "high" || p.status === "low";
            return (
              <g key={p.id}>
                {out && <circle cx={x(readingTime(p))} cy={y(p.value)} r={7} fill="none" stroke={LIMIT_COLOUR} strokeWidth={1.5} />}
                <circle cx={x(readingTime(p))} cy={y(p.value)} r={active === i ? 5 : 3.5} fill={SITE_COLOUR} stroke="#fff" strokeWidth={1.5} />
              </g>
            );
          })}
          {lab.map(({ p, i }) => {
            const cx = x(readingTime(p));
            const cy = y(p.value);
            const s = active === i ? 7 : 5.5;
            const out = p.status === "high" || p.status === "low";
            return (
              <g key={p.id}>
                {out && <circle cx={cx} cy={cy} r={9} fill="none" stroke={LIMIT_COLOUR} strokeWidth={1.5} />}
                <path
                  d={`M${cx},${cy - s}L${cx + s},${cy}L${cx},${cy + s}L${cx - s},${cy}Z`}
                  fill={p.below_detection ? "#fff" : LAB_COLOUR}
                  stroke={p.below_detection ? LAB_COLOUR : "#fff"}
                  strokeWidth={p.below_detection ? 2 : 1.5}
                />
              </g>
            );
          })}
        </svg>
        <Tooltip
          width={width}
          tip={
            a
              ? {
                  x: x(readingTime(a)),
                  y: y(a.value) - 6,
                  title: `${formatDay(a.sampled_on)} · ${a.source === "lab" ? `Lab ${a.reference}` : `Inspection ${a.reference}`}`,
                  rows: [
                    {
                      label: parameter.name,
                      value: `${formatResult(a.value, a.below_detection, a.decimals)} ${unit}`,
                      colour: a.source === "lab" ? LAB_COLOUR : SITE_COLOUR,
                    },
                    { label: "Status", value: STATUS_LABELS[a.status] },
                    ...(a.asset_name ? [{ label: "Asset", value: a.asset_name }] : []),
                  ],
                }
              : null
          }
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: SITE_COLOUR }} aria-hidden="true" />
          Site reading ({site.length})
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rotate-45" style={{ background: LAB_COLOUR }} aria-hidden="true" />
          Lab result ({lab.length})
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 border-t-2 border-dashed" style={{ borderColor: LIMIT_COLOUR }} aria-hidden="true" />
          Limit
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full border-[1.5px]" style={{ borderColor: LIMIT_COLOUR }} aria-hidden="true" />
          Out of spec
        </span>
      </div>
    </div>
  );
}
