"use client";

import { changedFields } from "@/lib/grid/fields";
import type { GridSpec } from "@/lib/grid/types";
import { formatMoney, formatPeriod } from "@/lib/billing/format";
import type { BillingRunRow } from "@/lib/billing/types";
import { changedByOptions, changedColumns, type GridColumn } from "../grid/columns";
import { Grid } from "../grid/grid";

// Billing runs, one per month. A run isn't edited once generated, so Changed
// / Changed by are when and by whom it was (last) generated.
const runsGrid: GridSpec = {
  id: "billing-runs",
  fields: [
    { key: "month", label: "Month", filter: "date" },
    { key: "draft", label: "Draft", filter: "number" },
    { key: "approved", label: "Approved", filter: "number" },
    { key: "void", label: "Void", filter: "number", hideable: true },
    { key: "amount_draft", label: "Draft amount", filter: "number" },
    { key: "amount_approved", label: "Approved amount", filter: "number" },
    ...changedFields(),
  ],
  defaultSort: { key: "month", desc: true },
};

const runHref = (r: BillingRunRow) => `/admin/billing/runs/${r.id}`;

export function RunsTable({ runs, timeZone }: { runs: BillingRunRow[]; timeZone: string }) {
  const columns: GridColumn<BillingRunRow>[] = [
    { key: "month", render: (r) => formatPeriod(r.period), value: (r) => r.period },
    { key: "draft", align: "right", render: (r) => r.draft, value: (r) => r.draft },
    { key: "approved", align: "right", render: (r) => r.approved, value: (r) => r.approved },
    { key: "void", align: "right", render: (r) => <span className="text-muted">{r.void}</span>, value: (r) => r.void },
    { key: "amount_draft", align: "right", render: (r) => formatMoney(r.amount_draft), value: (r) => r.amount_draft },
    {
      key: "amount_approved",
      align: "right",
      render: (r) => <span className="font-semibold">{formatMoney(r.amount_approved)}</span>,
      value: (r) => r.amount_approved,
    },
    ...changedColumns<BillingRunRow>(timeZone),
  ];

  return (
    <Grid
      mode="client"
      spec={runsGrid}
      rows={runs}
      columns={columns}
      getKey={(r) => r.id}
      title="Billing runs"
      timeZone={timeZone}
      rowHref={runHref}
      rowLabel={(r) => `the ${formatPeriod(r.period)} run`}
      rowMenu={(r) => [
        { label: "Open", href: runHref(r) },
        ...(r.approved > 0
          ? [{ label: "Download approved PDFs", href: `${runHref(r)}/pdf`, download: true }]
          : []),
      ]}
      options={{ changed_by: changedByOptions(runs) }}
      emptyLabel="No billing runs yet. Generate the first month above."
    />
  );
}
