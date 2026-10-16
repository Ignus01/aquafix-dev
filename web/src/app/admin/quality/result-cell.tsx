import { BAND_STYLES } from "../dashboard/water-format";
import { STATUS_ARROWS, STATUS_LABELS, formatResult, resultTitle } from "@/lib/quality/evaluate";
import type { ResultStatus } from "@/lib/quality/types";

// Result colours reuse the Water usage tab's band tints, so Quality reads the
// same: green acceptable, red out of spec, orange inconclusive, none without
// a limit.
export const STATUS_STYLE: Record<ResultStatus, { bg: string; text: string; swatch: string } | null> = {
  ok: BAND_STYLES.green,
  high: BAND_STYLES.red,
  low: BAND_STYLES.red,
  inconclusive: BAND_STYLES.orange,
  no_limit: null,
};

export type ResultLike = {
  value: number;
  below_detection: boolean;
  decimals: number;
  unit: string;
  name: string;
  min_acceptable: number | null;
  max_acceptable: number | null;
  status: ResultStatus;
};

// A result value, tinted by its status, with the reason on hover.
export function ResultValue({ r, className = "" }: { r: ResultLike; className?: string }) {
  const style = STATUS_STYLE[r.status];
  const text = formatResult(r.value, r.below_detection, r.decimals);
  const arrow = STATUS_ARROWS[r.status];
  return (
    <span
      title={resultTitle(r.name, text, r.unit, r, r.status)}
      className={`inline-flex items-center gap-1 rounded-[5px] px-1.5 py-0.5 font-mono text-[13px] whitespace-nowrap tabular-nums ${className}`}
      style={style ? { background: style.bg, color: style.text } : undefined}
    >
      {text}
      {arrow && <span aria-label={STATUS_LABELS[r.status]}>{arrow}</span>}
    </span>
  );
}

export function StatusPill({ status }: { status: ResultStatus }) {
  const style = STATUS_STYLE[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap"
      style={style ? { background: style.bg, color: style.text } : { background: "rgba(0,0,0,.04)", color: "var(--color-muted)" }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: style?.swatch ?? "#9aa3b5" }} />
      {STATUS_LABELS[status]}
    </span>
  );
}

// The Out of spec cell: "2 — Mn, NTU", or "0".
export function OutOfSpec({ count, names, inconclusive }: { count: number; names: string[]; inconclusive?: number }) {
  if (count === 0 && !inconclusive) return <span className="text-muted">0</span>;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {count > 0 && (
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap"
          style={{ background: BAND_STYLES.red.bg, color: BAND_STYLES.red.text }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: BAND_STYLES.red.swatch }} />
          {count} — {names.join(", ")}
        </span>
      )}
      {inconclusive ? (
        <span
          className="rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap"
          style={{ background: BAND_STYLES.orange.bg, color: BAND_STYLES.orange.text }}
        >
          {inconclusive} inconclusive
        </span>
      ) : null}
    </span>
  );
}
