import { PO_STATUS_LABELS } from "@/lib/stock-manager/docs";

export function formatQty(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export function formatMoney(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function PoStatusBadge({ status }: { status: string }) {
  const s =
    status === "completed"
      ? "bg-success-bg text-success"
      : status === "closed"
        ? "bg-warning-bg text-warning"
        : "bg-black/[.04] text-muted";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${s}`}>
      {PO_STATUS_LABELS[status] ?? status}
    </span>
  );
}
