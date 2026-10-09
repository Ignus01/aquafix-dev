import Link from "next/link";
import { ChevronRightIcon } from "../icons";
import { Sparkline } from "./charts";

// Building blocks shared by the home page's tabs: stat tiles, cards and the
// change-vs-previous-period figures.

export type Delta = { text: string; good: boolean | null };

// Signed change vs the previous period; `upIsGood` sets the colour.
export function delta(cur: number, prev: number, upIsGood: boolean): Delta | undefined {
  if (!prev) return undefined;
  const change = (cur - prev) / prev;
  const rounded = Math.round(change * 100);
  if (rounded === 0) return { text: "No change vs previous period", good: null };
  return {
    text: `${rounded > 0 ? "▲" : "▼"} ${Math.abs(rounded)}% vs previous period`,
    good: rounded > 0 === upIsGood,
  };
}

// Change in a share, in percentage points; down is good.
export function shareDelta(cur: number | null, prev: number | null): Delta | undefined {
  if (cur === null || prev === null) return undefined;
  const pts = (cur - prev) * 100;
  if (Math.abs(pts) < 0.05) return { text: "No change vs previous period", good: null };
  return {
    text: `${pts > 0 ? "▲" : "▼"} ${Math.abs(pts).toFixed(1)} pts vs previous period`,
    good: pts < 0,
  };
}

export const TONE_PILL = {
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  danger: "bg-danger-bg text-danger",
  neutral: "bg-black/[.04] text-muted",
} as const;

export function Kpi({
  label,
  value,
  note,
  delta,
  flag,
  trend,
  trendColour,
  tone,
  href,
  className = "",
}: {
  className?: string;
  label: string;
  value: string;
  note: string;
  delta?: Delta;
  flag?: { text: string; tone: keyof typeof TONE_PILL };
  trend?: (number | null)[];
  trendColour?: string;
  tone?: "warning" | "danger";
  href?: string;
}) {
  const stripe = tone === "danger" ? "bg-danger" : tone === "warning" ? "bg-warning" : "bg-primary";
  return (
    <div className={`relative flex flex-col overflow-hidden rounded-card border border-border bg-card px-5 pt-4 pb-3 ${className}`}>
      <span className={`absolute inset-y-0 left-0 w-[3px] ${stripe}`} aria-hidden="true" />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold tracking-wider text-muted uppercase">{label}</span>
        {href && (
          <Link href={href} aria-label={`Open ${label}`} className="text-muted hover:text-primary">
            <ChevronRightIcon className="h-4 w-4" />
          </Link>
        )}
      </div>
      <div className="mt-2 text-[30px] leading-none font-semibold tracking-tight text-ink">{value}</div>
      {delta && (
        <div
          className={`mt-2 text-xs font-semibold ${
            delta.good === null ? "text-muted" : delta.good ? "text-success" : "text-danger"
          }`}
        >
          {delta.text}
        </div>
      )}
      {flag && (
        <div className="mt-2">
          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${TONE_PILL[flag.tone]}`}>
            {flag.text}
          </span>
        </div>
      )}
      <p className="mt-2 text-[13px] leading-snug text-muted">{note}</p>
      {trend && trend.length > 2 && (
        <div className="mt-auto pt-2">
          <Sparkline values={trend} colour={trendColour} ariaLabel={`${label} trend`} />
        </div>
      )}
    </div>
  );
}

export function Card({
  title,
  caption,
  className = "",
  children,
}: {
  title: string;
  caption?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`min-w-0 rounded-card border border-border bg-card px-5 pt-4 pb-4 ${className}`}>
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      {caption && <p className="mt-0.5 mb-4 text-[13px] leading-snug text-muted">{caption}</p>}
      {children}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted">{children}</p>;
}

export function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold tracking-wider text-muted uppercase">{label}</dt>
      <dd className="mt-0.5 font-mono text-lg text-ink tabular-nums">{value}</dd>
    </div>
  );
}
