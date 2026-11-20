"use client";

import type { GridSpec } from "@/lib/grid/types";
import { Grid } from "../grid/grid";
import type { GridColumn } from "../grid/columns";
import { formatMoney, formatQty } from "./format";
import type { CostPerSiteRow, MissingStockRow } from "./actions";

// "Nov 2026" from "2026-11-01".
export function formatMonth(day: string): string {
  const [y, m] = day.split("-").map(Number);
  return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${y}`;
}

const movementsHref = (itemId: string, areaId?: string) =>
  `/admin/stock-manager?tab=transactions&item=${itemId}${areaId ? `&area=${areaId}` : ""}`;

function ValueCell({ value, untraced }: { value: number | null; untraced: number }) {
  return (
    <span className="tabular-nums">
      {value === null ? "—" : formatMoney(value)}
      {untraced !== 0 && (
        <span className="ml-1 text-xs text-warning" title={`${formatQty(untraced)} came from stock with no known batch, so it has no price.`}>
          (+{formatQty(untraced)} unpriced)
        </span>
      )}
    </span>
  );
}

function Total({ label, value }: { label: string; value: number }) {
  return (
    <p className="mt-2 text-sm text-muted">
      {label}: <span className="font-semibold text-ink tabular-nums">R {formatMoney(value)}</span> exc. VAT
    </p>
  );
}

// R8 · Stock usage per site, month and item at the price actually paid.
const costGrid: GridSpec = {
  id: "stock-cost-per-site",
  fields: [
    { key: "item", label: "Item", filter: "text" },
    { key: "month", label: "Month", filter: "date" },
    { key: "site", label: "Site", filter: "choice" },
    { key: "qty", label: "Qty used", filter: "number" },
    { key: "value", label: "Cost exc. VAT", filter: "number" },
  ],
  defaultSort: { key: "month", desc: false },
  changedException: "A report worked out from the ledger, not records anyone edits.",
};

export function CostPerSite({ rows, timeZone }: { rows: CostPerSiteRow[]; timeZone: string }) {
  const sites = [...new Map(rows.map((r) => [r.site, { value: r.site, label: r.site }])).values()].sort((a, b) =>
    a.label.localeCompare(b.label),
  );
  const columns: GridColumn<CostPerSiteRow>[] = [
    { key: "item", render: (r) => r.item, value: (r) => r.item },
    { key: "month", render: (r) => formatMonth(r.month), value: (r) => r.month },
    { key: "site", render: (r) => r.site, value: (r) => r.site },
    { key: "qty", align: "right", render: (r) => formatQty(r.qty), value: (r) => r.qty },
    {
      key: "value",
      align: "right",
      render: (r) => <ValueCell value={r.value_exc_vat} untraced={r.untraced_qty} />,
      value: (r) => r.value_exc_vat,
    },
  ];
  return (
    <>
      <Grid
        mode="client"
        prefix="cost"
        spec={costGrid}
        rows={rows}
        columns={columns}
        getKey={(r) => `${r.month}:${r.site}:${r.item_id}`}
        title="Cost per site"
        timeZone={timeZone}
        rowHref={(r) => movementsHref(r.item_id)}
        rowLabel={(r) => `${r.item} at ${r.site}, ${formatMonth(r.month)}`}
        rowMenu={(r) => [{ label: "Movements", href: movementsHref(r.item_id) }]}
        options={{ site: sites }}
        emptyLabel="No stock was used in these months."
      />
      <Total label="Total cost" value={rows.reduce((s, r) => s + (r.value_exc_vat ?? 0), 0)} />
    </>
  );
}

// Kit counts that came up short, per technician.
const missingGrid: GridSpec = {
  id: "stock-missing",
  fields: [
    { key: "item", label: "Item", filter: "text" },
    { key: "month", label: "Month", filter: "date" },
    { key: "technician", label: "Technician", filter: "choice" },
    { key: "area", label: "Kit", filter: "choice" },
    { key: "qty", label: "Qty missing", filter: "number" },
    { key: "value", label: "Value exc. VAT", filter: "number" },
  ],
  defaultSort: { key: "month", desc: false },
  changedException: "A report worked out from the ledger, not records anyone edits.",
};

export function MissingStock({ rows, timeZone }: { rows: MissingStockRow[]; timeZone: string }) {
  const people = [...new Map(rows.map((r) => [r.technician, { value: r.technician, label: r.technician }])).values()];
  const kits = [...new Map(rows.map((r) => [r.storage_area_id, { value: r.storage_area_id, label: r.storage_area }])).values()];
  const columns: GridColumn<MissingStockRow>[] = [
    { key: "item", render: (r) => r.item, value: (r) => r.item },
    { key: "month", render: (r) => formatMonth(r.month), value: (r) => r.month },
    { key: "technician", render: (r) => r.technician, value: (r) => r.technician },
    { key: "area", render: (r) => r.storage_area, value: (r) => r.storage_area_id, sortValue: (r) => r.storage_area },
    {
      key: "qty",
      align: "right",
      render: (r) => <span className={r.qty > 0 ? "font-semibold text-danger" : undefined}>{formatQty(r.qty)}</span>,
      value: (r) => r.qty,
    },
    {
      key: "value",
      align: "right",
      render: (r) => <ValueCell value={r.value_exc_vat} untraced={r.untraced_qty} />,
      value: (r) => r.value_exc_vat,
    },
  ];
  return (
    <>
      <Grid
        mode="client"
        prefix="missing"
        spec={missingGrid}
        rows={rows}
        columns={columns}
        getKey={(r) => `${r.month}:${r.storage_area_id}:${r.item_id}`}
        title="Missing stock"
        timeZone={timeZone}
        rowHref={(r) => movementsHref(r.item_id, r.storage_area_id)}
        rowLabel={(r) => `${r.item} missing from ${r.storage_area}, ${formatMonth(r.month)}`}
        rowMenu={(r) => [{ label: "Movements", href: movementsHref(r.item_id, r.storage_area_id) }]}
        options={{ technician: people, area: kits }}
        emptyLabel="No kit count came up short in these months."
      />
      <Total label="Total missing" value={rows.reduce((s, r) => s + (r.value_exc_vat ?? 0), 0)} />
    </>
  );
}
