"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { formatDay } from "@/lib/dashboard/format";
import { formatMoney, formatQty, formatRate } from "@/lib/billing/format";
import { invoiceIssues, issueLabel } from "@/lib/billing/issues";
import type { InvoiceRow, InvoiceStatus } from "@/lib/billing/types";
import { SearchInput } from "../../../data-grid";
import { DownloadIcon } from "../../../icons";
import { secondaryButtonClass, smallPrimaryButtonClass } from "../../../ui";
import { approveInvoices, generateRun } from "../../actions";
import { InvoiceStatusBadge } from "../../status";

const th = "px-3 py-2.5 text-left text-[11px] font-semibold text-muted whitespace-nowrap";

type Filter = "all" | "ready" | "blocked" | "warnings" | InvoiceStatus;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "ready", label: "Ready to approve" },
  { key: "blocked", label: "Blocked" },
  { key: "warnings", label: "Drafts with warnings" },
  { key: "approved", label: "Approved" },
  { key: "void", label: "Void" },
];

function classify(inv: InvoiceRow) {
  const issues = invoiceIssues(inv.issues);
  const blocking = issues.filter((i) => i.blocking);
  const warnings = issues.filter((i) => !i.blocking);
  return { issues, blocking, warnings, ready: inv.status === "draft" && blocking.length === 0 && inv.amount !== null };
}

export function InvoicesReview({ runId, period, invoices }: { runId: string; period: string; invoices: InvoiceRow[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string; details?: string[] } | null>(null);
  const [pending, startTransition] = useTransition();

  const info = useMemo(() => new Map(invoices.map((i) => [i.id, classify(i)])), [invoices]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return invoices.filter((inv) => {
      const c = info.get(inv.id)!;
      if (q && ![inv.location_name, inv.organisation_name, inv.invoice_no].some((v) => v?.toLowerCase().includes(q)))
        return false;
      switch (filter) {
        case "ready":
          return c.ready;
        case "blocked":
          return inv.status === "draft" && !c.ready;
        case "warnings":
          return inv.status === "draft" && c.warnings.length > 0;
        case "approved":
        case "void":
        case "draft":
          return inv.status === filter;
        default:
          return true;
      }
    });
  }, [invoices, info, query, filter]);

  const drafts = invoices.filter((i) => i.status === "draft");
  const approved = invoices.filter((i) => i.status === "approved");
  const selectable = rows.filter((i) => i.status === "draft");
  const selectedDrafts = [...selected].filter((id) => drafts.some((d) => d.id === id));
  const allSelected = selectable.length > 0 && selectable.every((i) => selected.has(i.id));

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

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

  const total = (list: InvoiceRow[]) => list.reduce((t, i) => t + (i.amount ?? 0), 0);
  const readyCount = drafts.filter((d) => info.get(d.id)!.ready).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Drafts" value={String(drafts.length)} sub={formatMoney(total(drafts))} />
        <Stat label="Ready to approve" value={String(readyCount)} />
        <Stat label="Blocked" value={String(drafts.length - readyCount)} tone={drafts.length - readyCount > 0 ? "danger" : undefined} />
        <Stat label="Approved" value={String(approved.length)} sub={formatMoney(total(approved))} />
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <SearchInput value={query} onChange={setQuery} placeholder="Search locations…" />
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                filter === f.key ? "bg-primary text-white" : "bg-black/[.04] text-muted hover:text-ink"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => regenerate(selectedDrafts.length > 0 ? invoices.filter((i) => selectedDrafts.includes(i.id)).map((i) => i.location_id) : null)}
            className={`${secondaryButtonClass} h-[34px] text-[13px]`}
          >
            {selectedDrafts.length > 0 ? `Regenerate ${selectedDrafts.length} selected` : "Regenerate all drafts"}
          </button>
          <button
            type="button"
            disabled={pending || selectedDrafts.length === 0}
            onClick={() => approve(selectedDrafts)}
            className={`${smallPrimaryButtonClass} h-[34px]`}
          >
            Approve {selectedDrafts.length > 0 ? `${selectedDrafts.length} selected` : "selected"}
          </button>
          {approved.length > 0 && (
            <a
              href={`/admin/billing/runs/${runId}/pdf`}
              className={`${secondaryButtonClass} flex h-[34px] items-center gap-1.5 text-[13px]`}
            >
              <DownloadIcon className="h-4 w-4" />
              All approved PDFs
            </a>
          )}
        </div>
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

      <div className="overflow-hidden rounded-card border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-table-head">
                <th className={`${th} w-10`}>
                  <input
                    type="checkbox"
                    aria-label="Select all drafts shown"
                    checked={allSelected}
                    disabled={selectable.length === 0}
                    onChange={() =>
                      setSelected((s) => {
                        const next = new Set(s);
                        for (const i of selectable) {
                          if (allSelected) next.delete(i.id);
                          else next.add(i.id);
                        }
                        return next;
                      })
                    }
                  />
                </th>
                <th className={th}>Location</th>
                <th className={th}>Period</th>
                <th className={`${th} text-right`}>Treated (kL)</th>
                <th className={`${th} text-right`}>Rate</th>
                <th className={`${th} text-right`}>Amount</th>
                <th className={th}>Status</th>
                <th className={th}>Checks</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted">
                    {invoices.length === 0 ? "No invoices in this run. Set billing days under Location setup." : "No invoices match."}
                  </td>
                </tr>
              )}
              {rows.map((inv) => {
                const c = info.get(inv.id)!;
                return (
                  <tr
                    key={inv.id}
                    onClick={() => router.push(`/admin/billing/invoices/${inv.id}`)}
                    className="h-[52px] cursor-pointer border-t border-border transition-colors hover:bg-row-hover"
                  >
                    <td className="px-3" onClick={(e) => e.stopPropagation()}>
                      {inv.status === "draft" && (
                        <input
                          type="checkbox"
                          aria-label={`Select ${inv.location_name}`}
                          checked={selected.has(inv.id)}
                          onChange={() => toggle(inv.id)}
                        />
                      )}
                    </td>
                    <td className="px-3">
                      <Link
                        href={`/admin/billing/invoices/${inv.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-semibold text-primary hover:text-primary-hover"
                      >
                        {inv.location_name}
                      </Link>
                      <div className="text-xs text-muted">{inv.invoice_no ?? inv.organisation_name ?? ""}</div>
                    </td>
                    <td className="px-3 whitespace-nowrap text-muted">
                      {formatDay(inv.period_start, false)} – {formatDay(inv.period_end)}
                    </td>
                    <td className="px-3 text-right text-ink tabular-nums">{formatQty(inv.treated_usage)}</td>
                    <td className="px-3 text-right whitespace-nowrap text-muted tabular-nums">{formatRate(inv.tariff_rate)}</td>
                    <td className="px-3 text-right whitespace-nowrap font-semibold text-ink tabular-nums">
                      {formatMoney(inv.amount)}
                    </td>
                    <td className="px-3">
                      <InvoiceStatusBadge status={inv.status} />
                    </td>
                    <td className="px-3">
                      {inv.status === "draft" ? (
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
                            <span className="rounded-full bg-success-bg px-2 py-0.5 text-xs font-semibold text-success">
                              All good
                            </span>
                          )}
                        </div>
                      ) : inv.status === "approved" ? (
                        <a
                          href={`/admin/billing/invoices/${inv.id}/pdf`}
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary-hover"
                        >
                          <DownloadIcon className="h-3.5 w-3.5" />
                          PDF
                        </a>
                      ) : (
                        <span className="text-xs text-muted">{inv.void_reason}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "danger" }) {
  return (
    <div className="rounded-card border border-border bg-card px-4 py-3">
      <div className="text-[11px] font-semibold tracking-wider text-muted uppercase">{label}</div>
      <div className={`mt-1 text-xl font-bold ${tone === "danger" ? "text-danger" : "text-ink"}`}>{value}</div>
      {sub && <div className="text-xs text-muted tabular-nums">{sub}</div>}
    </div>
  );
}
