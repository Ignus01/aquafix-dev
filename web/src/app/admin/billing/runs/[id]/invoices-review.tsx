"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { formatDay } from "@/lib/dashboard/format";
import { formatMoney, formatQty, formatRate } from "@/lib/billing/format";
import { invoiceIssues, issueLabel } from "@/lib/billing/issues";
import type { InvoiceListRow, InvoiceStatus } from "@/lib/billing/types";
import { changedFields } from "@/lib/grid/fields";
import type { GridSpec } from "@/lib/grid/types";
import { changedByOptions, changedColumns, Dash, type GridColumn } from "../../../grid/columns";
import { Grid } from "../../../grid/grid";
import { DownloadIcon } from "../../../icons";
import { secondaryButtonClass, smallPrimaryButtonClass } from "../../../ui";
import { approveInvoices, generateRun } from "../../actions";
import { InvoiceStatusBadge } from "../../status";

const STATUS_OPTIONS: { value: InvoiceStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "approved", label: "Approved" },
  { value: "void", label: "Void" },
];

// A draft's checks, as filter values: ready (no blocking issue and an
// amount), blocked, has warnings, all good. Approved and void invoices have
// none.
const CHECK_OPTIONS = [
  { value: "ready", label: "Ready to approve" },
  { value: "blocked", label: "Blocked" },
  { value: "warnings", label: "Has warnings" },
  { value: "ok", label: "All good" },
];

function classify(inv: InvoiceListRow) {
  const issues = invoiceIssues(inv.issues);
  const blocking = issues.filter((i) => i.blocking);
  const warnings = issues.filter((i) => !i.blocking);
  const ready = inv.status === "draft" && blocking.length === 0 && inv.amount !== null;
  const checks =
    inv.status !== "draft"
      ? []
      : [ready ? "ready" : "blocked", ...(warnings.length > 0 ? ["warnings"] : []), ...(issues.length === 0 ? ["ok"] : [])];
  return { issues, blocking, warnings, ready, checks };
}

const invoicesGrid: GridSpec = {
  id: "billing-invoices",
  fields: [
    { key: "location", label: "Location", filter: "text" },
    { key: "invoice_no", label: "Invoice / organisation", filter: "text", hideable: true },
    { key: "period", label: "Period", filter: "date", hideable: true },
    { key: "treated", label: "Treated (kL)", filter: "number" },
    { key: "rate", label: "Rate", filter: "number", hideable: true },
    { key: "amount", label: "Amount", filter: "number" },
    { key: "status", label: "Status", filter: "choice", options: STATUS_OPTIONS },
    { key: "checks", label: "Checks", filter: "choice", options: CHECK_OPTIONS, sortable: false },
    ...changedFields(),
  ],
  defaultSort: { key: "location", desc: false },
};

const invoiceHref = (inv: InvoiceListRow) => `/admin/billing/invoices/${inv.id}`;

export function InvoicesReview({ runId, period, invoices, timeZone }: { runId: string; period: string; invoices: InvoiceListRow[]; timeZone: string }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string; details?: string[] } | null>(null);
  const [pending, startTransition] = useTransition();

  const info = useMemo(() => new Map(invoices.map((i) => [i.id, classify(i)])), [invoices]);

  const drafts = invoices.filter((i) => i.status === "draft");
  const approved = invoices.filter((i) => i.status === "approved");
  const selectedDrafts = [...selected].filter((id) => drafts.some((d) => d.id === id));

  function approve(ids: string[]) {
    setMessage(null);
    startTransition(async () => {
      const result = await approveInvoices(ids);
      if (result.error) return setMessage({ tone: "error", text: result.error });
      const skipped = result.skipped ?? [];
      setMessage({
        tone: skipped.length > 0 ? "error" : "ok",
        text: `Approved ${result.approved} invoice${result.approved === 1 ? "" : "s"}.${
          skipped.length > 0 ? ` ${skipped.length} skipped:` : ""
        }`,
        details: skipped.map((s) => `${s.location} — ${s.reason.split(", ").map(issueLabel).join(", ")}`),
      });
      setSelected(new Set());
      router.refresh();
    });
  }

  function regenerate(locationIds: string[] | null) {
    setMessage(null);
    startTransition(async () => {
      const result = await generateRun(period, locationIds);
      if (result.error) return setMessage({ tone: "error", text: result.error });
      setMessage({
        tone: "ok",
        text: `Rebuilt ${result.created} draft invoice${result.created === 1 ? "" : "s"}${
          result.skipped ? `; ${result.skipped} already approved, kept` : ""
        }.`,
      });
      setSelected(new Set());
      router.refresh();
    });
  }

  // The summary cards double as quick filters (the grid reads the URL).
  function preset(qs: string) {
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }

  const total = (list: InvoiceListRow[]) => list.reduce((t, i) => t + (i.amount ?? 0), 0);
  const readyCount = drafts.filter((d) => info.get(d.id)!.ready).length;

  const columns: GridColumn<InvoiceListRow>[] = [
    { key: "location", render: (inv) => inv.location_name, value: (inv) => inv.location_name },
    {
      key: "invoice_no",
      render: (inv) => <span className="text-muted">{inv.invoice_no ?? inv.organisation_name ?? "—"}</span>,
      value: (inv) => inv.invoice_no ?? inv.organisation_name,
    },
    {
      key: "period",
      render: (inv) => (
        <span className="whitespace-nowrap text-muted">
          {formatDay(inv.period_start, false)} – {formatDay(inv.period_end)}
        </span>
      ),
      value: (inv) => inv.period_end,
    },
    { key: "treated", align: "right", render: (inv) => formatQty(inv.treated_usage), value: (inv) => inv.treated_usage },
    {
      key: "rate",
      align: "right",
      render: (inv) => <span className="text-muted">{formatRate(inv.tariff_rate)}</span>,
      value: (inv) => inv.tariff_rate,
    },
    {
      key: "amount",
      align: "right",
      render: (inv) => <span className="font-semibold">{formatMoney(inv.amount)}</span>,
      value: (inv) => inv.amount,
    },
    { key: "status", render: (inv) => <InvoiceStatusBadge status={inv.status} />, value: (inv) => inv.status },
    {
      key: "checks",
      render: (inv) => {
        const c = info.get(inv.id)!;
        if (inv.status === "approved") {
          return (
            <a
              href={`${invoiceHref(inv)}/pdf`}
              className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary-hover"
            >
              <DownloadIcon className="h-3.5 w-3.5" />
              PDF
            </a>
          );
        }
        if (inv.status === "void") return inv.void_reason ? <span className="text-xs text-muted">{inv.void_reason}</span> : <Dash />;
        return (
          <div className="flex flex-wrap gap-1" title={c.issues.map((i) => issueLabel(i.code)).join("\n")}>
            {c.blocking.length > 0 && (
              <span className="rounded-full bg-danger-bg px-2 py-0.5 text-xs font-semibold text-danger">
                {c.blocking.length === 1 ? issueLabel(c.blocking[0].code) : `${c.blocking.length} blocking`}
              </span>
            )}
            {c.warnings.length > 0 && (
              <span className="rounded-full bg-warning-bg px-2 py-0.5 text-xs font-semibold text-warning">
                {c.warnings.length} warning{c.warnings.length === 1 ? "" : "s"}
              </span>
            )}
            {c.issues.length === 0 && (
              <span className="rounded-full bg-success-bg px-2 py-0.5 text-xs font-semibold text-success">All good</span>
            )}
          </div>
        );
      },
      value: (inv) => info.get(inv.id)!.checks,
    },
    ...changedColumns<InvoiceListRow>(timeZone),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Drafts" value={String(drafts.length)} sub={formatMoney(total(drafts))} onClick={() => preset("f.status=draft")} />
        <Stat label="Ready to approve" value={String(readyCount)} onClick={() => preset("f.checks=ready")} />
        <Stat
          label="Blocked"
          value={String(drafts.length - readyCount)}
          tone={drafts.length - readyCount > 0 ? "danger" : undefined}
          onClick={() => preset("f.checks=blocked")}
        />
        <Stat label="Approved" value={String(approved.length)} sub={formatMoney(total(approved))} onClick={() => preset("f.status=approved")} />
      </div>

      {message && (
        <div
          className={`rounded-card border px-4 py-3 text-sm ${
            message.tone === "ok" ? "border-success/30 bg-success-bg text-success" : "border-danger/30 bg-danger-bg text-danger"
          }`}
        >
          {message.text}
          {message.details && message.details.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {message.details.map((d) => (
                <li key={d}>{d}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Grid
        mode="client"
        spec={invoicesGrid}
        rows={invoices}
        columns={columns}
        getKey={(inv) => inv.id}
        title="Invoices"
        timeZone={timeZone}
        rowHref={invoiceHref}
        rowLabel={(inv) => inv.location_name}
        rowMenu={(inv) => [
          { label: "Open", href: invoiceHref(inv) },
          ...(inv.status === "draft"
            ? [
                { label: "Approve", onSelect: () => approve([inv.id]) },
                { label: "Regenerate", onSelect: () => regenerate([inv.location_id]) },
              ]
            : []),
          ...(inv.status === "approved"
            ? [{ label: "Download PDF", href: `${invoiceHref(inv)}/pdf`, download: true }]
            : []),
        ]}
        selection={{ selected, onChange: setSelected, isSelectable: (inv) => inv.status === "draft" }}
        options={{ changed_by: changedByOptions(invoices) }}
        emptyLabel="No invoices in this run. Set billing days under Location setup."
        primaryAction={
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                regenerate(
                  selectedDrafts.length > 0
                    ? invoices.filter((i) => selectedDrafts.includes(i.id)).map((i) => i.location_id)
                    : null,
                )
              }
              className={`${secondaryButtonClass} h-[38px] text-[13px]`}
            >
              {selectedDrafts.length > 0 ? `Regenerate ${selectedDrafts.length} selected` : "Regenerate all drafts"}
            </button>
            {approved.length > 0 && (
              <a
                href={`/admin/billing/runs/${runId}/pdf`}
                className={`${secondaryButtonClass} flex h-[38px] items-center gap-1.5 text-[13px]`}
              >
                <DownloadIcon className="h-4 w-4" />
                All approved PDFs
              </a>
            )}
            <button
              type="button"
              disabled={pending || selectedDrafts.length === 0}
              onClick={() => approve(selectedDrafts)}
              className={`${smallPrimaryButtonClass} h-[38px]`}
            >
              Approve {selectedDrafts.length > 0 ? `${selectedDrafts.length} selected` : "selected"}
            </button>
          </div>
        }
      />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "danger";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`Show ${label.toLowerCase()}`}
      className="rounded-card border border-border bg-card px-4 py-3 text-left transition-colors hover:border-primary/40"
    >
      <div className="text-[11px] font-semibold tracking-wider text-muted uppercase">{label}</div>
      <div className={`mt-1 text-xl font-bold ${tone === "danger" ? "text-danger" : "text-ink"}`}>{value}</div>
      {sub && <div className="text-xs text-muted tabular-nums">{sub}</div>}
    </button>
  );
}
