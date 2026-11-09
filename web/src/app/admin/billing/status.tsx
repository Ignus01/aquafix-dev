import type { InvoiceStatus } from "@/lib/billing/types";

const STYLES: Record<InvoiceStatus, { label: string; className: string; dot: string }> = {
  draft: { label: "Draft", className: "bg-warning-bg text-warning", dot: "bg-warning" },
  approved: { label: "Approved", className: "bg-success-bg text-success", dot: "bg-success" },
  void: { label: "Void", className: "bg-black/[.04] text-muted", dot: "bg-muted" },
};

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const s = STYLES[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${s.className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}
