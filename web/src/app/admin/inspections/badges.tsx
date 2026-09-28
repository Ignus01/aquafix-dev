import {
  INSTRUCTION_STATUS_LABELS,
  type GradingBadgeData,
  type InstructionStatus,
} from "@/lib/inspections/types";
import { GradingDot } from "../inspection-setup/grading-dot";

// Masterdata.SNIP_Grading: the grading's colour and name.
export function GradingBadge({ grading }: { grading: GradingBadgeData | null }) {
  if (!grading) return <span className="text-muted">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-ink">
      <GradingDot colour={grading.hex_colour} />
      {grading.name}
    </span>
  );
}

const STATUS_STYLES: Record<InstructionStatus, { pill: string; dot: string }> = {
  new: { pill: "bg-warning-bg text-warning", dot: "bg-warning" },
  in_progress: { pill: "bg-primary/10 text-primary", dot: "bg-primary" },
  completed: { pill: "bg-success-bg text-success", dot: "bg-success" },
};

export function InstructionStatusBadge({ status }: { status: InstructionStatus }) {
  const s = STATUS_STYLES[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${s.pill}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {INSTRUCTION_STATUS_LABELS[status]}
    </span>
  );
}

// `{completed} / {total}` with a thin bar.
export function Progress({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-black/[.06]">
        <span
          className={`block h-full rounded-full ${done === total && total > 0 ? "bg-success" : "bg-primary"}`}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="text-[13px] text-ink tabular-nums">
        {done} / {total}
      </span>
    </span>
  );
}

export function YesNo({ value }: { value: boolean }) {
  return <span className={value ? "text-ink" : "text-muted"}>{value ? "Yes" : "No"}</span>;
}
