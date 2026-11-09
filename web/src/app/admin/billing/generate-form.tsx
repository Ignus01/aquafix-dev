"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formatPeriod, parsePeriod } from "@/lib/billing/format";
import { inputClass, labelClass, primaryButtonClass } from "../ui";
import { generateRun } from "./actions";

// Generates (or rebuilds) the draft invoices of a month and opens the run.
export function GenerateForm({
  defaultMonth,
  billedCount,
  noTariffCount,
  unbilledCount,
}: {
  defaultMonth: string;
  billedCount: number;
  noTariffCount: number;
  unbilledCount: number;
}) {
  const router = useRouter();
  const [month, setMonth] = useState(defaultMonth);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function generate() {
    setError(null);
    startTransition(async () => {
      const result = await generateRun(month);
      if (result.error) setError(result.error);
      else if (result.runId) router.push(`/admin/billing/runs/${result.runId}`);
    });
  }

  const period = parsePeriod(month);

  return (
    <section className="rounded-card border border-border bg-card p-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex w-48 flex-col gap-1.5">
          <span className={labelClass}>Billing month</span>
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className={inputClass} />
        </label>
        <button type="button" onClick={generate} disabled={pending || !period} className={primaryButtonClass}>
          {pending ? "Generating…" : "Generate draft invoices"}
        </button>
      </div>
      <p className="mt-3 text-[13px] text-muted">
        {period ? (
          <>
            Makes a draft invoice for each of the {billedCount} location{billedCount === 1 ? "" : "s"} with a billing
            day, for the period ending on its billing day in {formatPeriod(period)}. Running it again rebuilds the
            drafts; approved invoices are kept.
          </>
        ) : (
          "Choose a month."
        )}
        {(noTariffCount > 0 || unbilledCount > 0) && (
          <>
            {" "}
            {noTariffCount > 0 && <span className="text-warning">{noTariffCount} billed location(s) have no tariff. </span>}
            {unbilledCount > 0 && <span>{unbilledCount} active location(s) have no billing day. </span>}
            <Link href="/admin/billing?tab=setup" className="font-semibold text-primary hover:text-primary-hover">
              Location setup
            </Link>
          </>
        )}
      </p>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </section>
  );
}
