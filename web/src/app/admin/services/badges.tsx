import { SERVICE_TYPE_LABELS, type ServiceType } from "@/lib/services/types";

export function ServiceTypeBadge({ type }: { type: ServiceType }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${
        type === "repair" ? "bg-warning-bg text-warning" : "bg-primary/10 text-primary"
      }`}
    >
      {SERVICE_TYPE_LABELS[type]}
    </span>
  );
}

// Completed, Overdue (open and past its due date) or Open.
export function ServiceStatusBadge({ completed, overdue }: { completed: boolean; overdue: boolean }) {
  const s = completed
    ? { label: "Completed", pill: "bg-success-bg text-success", dot: "bg-success" }
    : overdue
      ? { label: "Overdue", pill: "bg-danger-bg text-danger", dot: "bg-danger" }
      : { label: "Open", pill: "bg-black/[.04] text-muted", dot: "bg-muted" };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${s.pill}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}
