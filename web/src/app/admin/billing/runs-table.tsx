"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/incidents/format";
import { formatMoney, formatPeriod } from "@/lib/billing/format";
import type { BillingRunRow } from "@/lib/billing/types";

const th = "px-4 py-2.5 text-left text-[11px] font-semibold text-muted whitespace-nowrap";

export function RunsTable({ runs, timeZone }: { runs: BillingRunRow[]; timeZone: string }) {
  const router = useRouter();
  return (
    <div className="overflow-hidden rounded-card border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-table-head">
              <th className={th}>Month</th>
              <th className={th}>Draft</th>
              <th className={th}>Approved</th>
              <th className={th}>Void</th>
              <th className={`${th} text-right`}>Draft amount</th>
              <th className={`${th} text-right`}>Approved amount</th>
              <th className={th}>Last generated</th>
            </tr>
          </thead>
          <tbody>
            {runs.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted">
                  No billing runs yet. Generate the first month above.
                </td>
              </tr>
            )}
            {runs.map((r) => (
              <tr
                key={r.id}
                onClick={() => router.push(`/admin/billing/runs/${r.id}`)}
                className="h-[50px] cursor-pointer border-t border-border transition-colors hover:bg-row-hover"
              >
                <td className="px-4 whitespace-nowrap">
                  <Link
                    href={`/admin/billing/runs/${r.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="font-semibold text-primary hover:text-primary-hover"
                  >
                    {formatPeriod(r.period)}
                  </Link>
                </td>
                <td className="px-4 text-ink">{r.draft}</td>
                <td className="px-4 text-ink">{r.approved}</td>
                <td className="px-4 text-muted">{r.void}</td>
                <td className="px-4 text-right whitespace-nowrap text-ink tabular-nums">{formatMoney(r.amount_draft)}</td>
                <td className="px-4 text-right whitespace-nowrap font-semibold text-ink tabular-nums">
                  {formatMoney(r.amount_approved)}
                </td>
                <td className="px-4 whitespace-nowrap text-muted">{formatDateTime(r.generated_at, timeZone)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
