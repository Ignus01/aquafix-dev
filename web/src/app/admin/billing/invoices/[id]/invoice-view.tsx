"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formatDay } from "@/lib/dashboard/format";
import { formatDateTime } from "@/lib/incidents/format";
import { formatMoney, formatQty, formatRate } from "@/lib/billing/format";
import { SOURCE_LABELS, invoiceIssues, issueLabel } from "@/lib/billing/issues";
import { METER_UNIT, billingMeterLabel, type InvoiceLineView, type ReadingSide } from "@/lib/billing/types";
import { CameraIcon, DownloadIcon } from "../../../icons";
import { Modal } from "../../../modal";
import { inputClass, labelClass, linkButtonClass, primaryButtonClass, secondaryButtonClass } from "../../../ui";
import { approveInvoices, generateRun, voidInvoice, type InvoiceDetail } from "../../actions";
import { InvoiceStatusBadge } from "../../status";
import { ReadingPicker } from "./reading-picker";

export function InvoiceView({ detail, timeZone }: { detail: InvoiceDetail; timeZone: string }) {
  const router = useRouter();
  const { invoice, lines } = detail;
  const isDraft = invoice.status === "draft";
  const issues = invoiceIssues(invoice.issues);
  const blocking = issues.filter((i) => i.blocking);
  const [error, setError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const [picking, setPicking] = useState<{ line: InvoiceLineView; side: ReadingSide } | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<{ error: string | null }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
      else {
        after?.();
        router.refresh();
      }
    });
  }

  function approve() {
    setError(null);
    startTransition(async () => {
      const result = await approveInvoices([invoice.id]);
      if (result.error) return setError(result.error);
      if (result.skipped && result.skipped.length > 0) {
        return setError(`Not approved: ${result.skipped[0].reason.split(", ").map(issueLabel).join(", ")}`);
      }
      router.refresh();
    });
  }

  function regenerate() {
    setError(null);
    startTransition(async () => {
      const result = await generateRun(detail.period, [invoice.location_id]);
      if (result.error) return setError(result.error);
      // Regenerating replaces the draft, so go back to the run to open the new one.
      router.push(`/admin/billing/runs/${invoice.billing_run_id}`);
    });
  }

  const pdfHref = `/admin/billing/invoices/${invoice.id}/pdf`;

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-wrap items-start justify-between gap-4 rounded-card border border-border bg-card p-5">
        <div className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm md:grid-cols-4">
          <Field label="Status">
            <InvoiceStatusBadge status={invoice.status} />
          </Field>
          <Field label="Period">
            {formatDay(invoice.period_start)} – {formatDay(invoice.period_end)}
          </Field>
          <Field label="Organisation">{invoice.organisation_name ?? "—"}</Field>
          <Field label="Region">{invoice.region_name ?? "—"}</Field>
          <Field label="Treated water">{formatQty(invoice.treated_usage)} kL</Field>
          <Field label="Tariff">{formatRate(invoice.tariff_rate)} / kL</Field>
          <Field label="Amount">
            <span className="text-lg font-bold">{formatMoney(invoice.amount)}</span>
          </Field>
          <Field label={invoice.status === "approved" ? "Approved" : invoice.status === "void" ? "Voided" : "Generated"}>
            {invoice.status === "approved"
              ? `${formatDateTime(invoice.approved_at, timeZone)}${detail.approvedByName ? ` · ${detail.approvedByName}` : ""}`
              : invoice.status === "void"
                ? `${formatDateTime(invoice.voided_at, timeZone)} · ${invoice.void_reason ?? ""}`
                : formatDateTime(invoice.generated_at, timeZone)}
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          {isDraft && (
            <>
              <a href={pdfHref} target="_blank" rel="noreferrer" className={`${secondaryButtonClass} flex items-center`}>
                Preview PDF
              </a>
              <button type="button" disabled={pending} onClick={regenerate} className={secondaryButtonClass}>
                Regenerate
              </button>
              <button
                type="button"
                disabled={pending || blocking.length > 0 || invoice.amount === null}
                onClick={approve}
                className={primaryButtonClass}
                title={blocking.length > 0 ? "Fix the blocking checks first" : undefined}
              >
                Approve
              </button>
            </>
          )}
          {invoice.status === "approved" && (
            <>
              <button type="button" disabled={pending} onClick={() => setVoiding(true)} className={secondaryButtonClass}>
                Void
              </button>
              <a href={pdfHref} className={`${primaryButtonClass} flex items-center gap-2`}>
                <DownloadIcon className="h-4 w-4" />
                Download PDF
              </a>
            </>
          )}
        </div>
      </section>

      {error && <p className="rounded-card border border-danger/30 bg-danger-bg px-4 py-3 text-sm text-danger">{error}</p>}

      {isDraft && issues.length > 0 && (
        <section className="rounded-card border border-border bg-card p-5">
          <h2 className="mb-2 text-sm font-semibold text-ink">Checks</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {issues.map((i) => (
              <li key={i.code} className={i.blocking ? "text-danger" : "text-warning"}>
                {i.blocking ? "Blocking: " : "Warning: "}
                {issueLabel(i.code)}
              </li>
            ))}
          </ul>
          {blocking.some((b) => b.code === "no_tariff") && (
            <p className="mt-2 text-[13px] text-muted">
              Add a tariff under Billing → Location setup, then regenerate this invoice.
            </p>
          )}
        </section>
      )}

      {lines.length === 0 && (
        <p className="rounded-card border border-border bg-card px-4 py-8 text-center text-sm text-muted">
          This location has no billing meters. Set them under Billing → Location setup, then regenerate.
        </p>
      )}

      {lines.map((line) => (
        <section key={line.id} className="rounded-card border border-border bg-card">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
            <div>
              <span className="font-semibold text-ink">{line.asset_name}</span>
              <span className="ml-2 font-mono text-xs text-muted">{line.asset_code}</span>
              <span
                className={`ml-3 rounded-full px-2 py-0.5 text-xs font-semibold ${
                  line.meter === "treated" ? "bg-primary/10 text-primary" : "bg-black/[.04] text-muted"
                }`}
              >
                {billingMeterLabel(line.meter)}
                {line.meter !== "treated" && " · info only"}
              </span>
            </div>
            <div className="text-sm">
              <span className="text-muted">Usage </span>
              <span className={`font-bold tabular-nums ${line.usage !== null && line.usage < 0 ? "text-danger" : "text-ink"}`}>
                {formatQty(line.usage)} {METER_UNIT[line.meter]}
              </span>
            </div>
          </header>
          <div className="grid gap-4 p-5 md:grid-cols-2">
            {(["prev", "curr"] as const).map((side) => (
              <ReadingCard
                key={side}
                line={line}
                side={side}
                target={side === "prev" ? invoice.period_start : invoice.period_end}
                timeZone={timeZone}
                canChange={isDraft}
                onChange={() => setPicking({ line, side })}
              />
            ))}
          </div>
          {(line.note || line.issues.length > 0) && (
            <footer className="border-t border-border px-5 py-3 text-[13px]">
              {line.issues.length > 0 && (
                <div className="text-warning">{line.issues.map(issueLabel).join(" · ")}</div>
              )}
              {line.note && <div className="text-muted">Reviewer note: {line.note}</div>}
            </footer>
          )}
        </section>
      ))}

      {picking && (
        <ReadingPicker
          line={picking.line}
          side={picking.side}
          target={picking.side === "prev" ? invoice.period_start : invoice.period_end}
          timeZone={timeZone}
          onClose={() => setPicking(null)}
          onSaved={() => {
            setPicking(null);
            router.refresh();
          }}
        />
      )}

      <Modal
        open={voiding}
        title="Void invoice"
        onClose={() => setVoiding(false)}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setVoiding(false)} className={secondaryButtonClass}>
              Cancel
            </button>
            <button
              type="button"
              disabled={pending || !reason.trim()}
              onClick={() =>
                run(() => voidInvoice(invoice.id, reason), () => {
                  setVoiding(false);
                  setReason("");
                })
              }
              className={primaryButtonClass}
            >
              Void invoice
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-3 px-6 py-5">
          <p className="text-[13px] text-muted">
            The invoice stays on record as void. Regenerate the month for this location to make a new draft.
          </p>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>Reason</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} className={inputClass} />
          </label>
        </div>
      </Modal>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className={labelClass}>{label}</span>
      <span className="text-ink">{children}</span>
    </div>
  );
}

function ReadingCard({
  line,
  side,
  target,
  timeZone,
  canChange,
  onChange,
}: {
  line: InvoiceLineView;
  side: ReadingSide;
  target: string;
  timeZone: string;
  canChange: boolean;
  onChange: () => void;
}) {
  const value = side === "prev" ? line.prev_value : line.curr_value;
  const readAt = side === "prev" ? line.prev_read_at : line.curr_read_at;
  const source = side === "prev" ? line.prev_source : line.curr_source;
  const url = side === "prev" ? line.prev_image_url : line.curr_image_url;
  const outside = line.issues.includes(`${side}_outside_window`);

  return (
    <div className="flex gap-4 rounded-control border border-border p-3">
      <div className="flex h-36 w-36 shrink-0 items-center justify-center overflow-hidden rounded-control bg-table-head">
        {url ? (
          <a href={url} target="_blank" rel="noreferrer" className="h-full w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`${line.asset_name} ${side === "prev" ? "opening" : "closing"} reading`} className="h-full w-full object-cover" />
          </a>
        ) : (
          <div className="flex flex-col items-center gap-1 text-xs text-muted">
            <CameraIcon className="h-6 w-6" />
            No photo
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="text-[11px] font-semibold tracking-wider text-muted uppercase">
          {side === "prev" ? "Opening" : "Closing"} · billing date {formatDay(target)}
        </div>
        <div className="text-2xl font-bold text-ink tabular-nums">
          {value === null ? "—" : formatQty(value)}
          <span className="ml-1 text-sm font-normal text-muted">{METER_UNIT[line.meter]}</span>
        </div>
        <div className={`text-[13px] ${outside ? "font-semibold text-warning" : "text-muted"}`}>
          {readAt ? `Read ${formatDateTime(readAt, timeZone)}` : source === "manual" ? "Typed value" : "No reading"}
        </div>
        <div className="text-xs text-muted">{SOURCE_LABELS[source]}</div>
        {canChange && (
          <button type="button" onClick={onChange} className={`mt-auto self-start ${linkButtonClass}`}>
            Change reading
          </button>
        )}
      </div>
    </div>
  );
}
