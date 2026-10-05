"use client";

import Link from "next/link";
import { formatDate, formatDateTime } from "@/lib/incidents/format";
import {
  DOC_CONFIG,
  TRANSACTION_TYPE_LABELS,
  TRANSFER_TYPE_LABELS,
  docNumber,
  type DocKind,
  type Options,
} from "@/lib/stock-manager/docs";
import type { DocRow, LedgerRow, StockRow } from "@/lib/stock-manager/types";
import { DataTable, type Column } from "../inspections/data-table";
import { linkButtonClass } from "../ui";
import { PoStatusBadge, formatMoney, formatQty } from "./format";

const num = "whitespace-nowrap text-right text-ink tabular-nums";

function labelOf(options: Options, key: keyof Options, value: unknown): string {
  return options[key].find((o) => o.value === value)?.label ?? "—";
}

// Stock on hand: the sum of the ledger per item and storage area.
export function StockSummary({ rows }: { rows: StockRow[] }) {
  const columns: Column<StockRow>[] = [
    { key: "code", label: "Item code", render: (r) => r.item_code ?? "—", text: (r) => r.item_code },
    { key: "item", label: "Item", render: (r) => <span className="font-semibold">{r.item_name}</span>, text: (r) => r.item_name },
    { key: "area", label: "Storage area", render: (r) => r.storage_area_name, text: (r) => r.storage_area_name },
    {
      key: "qty",
      label: "On hand (packs)",
      render: (r) => <span className={r.qty < 0 ? "text-danger" : undefined}>{formatQty(r.qty)}</span>,
      text: (r) => r.qty,
      className: num,
    },
    {
      key: "base",
      label: "On hand (default unit)",
      render: (r) => `${formatQty(r.base_qty)} ${r.base_uom}`,
      text: (r) => r.base_qty,
      className: num,
    },
  ];
  return (
    <DataTable
      rows={rows}
      columns={columns}
      getKey={(r) => `${r.item_id}:${r.storage_area_id}`}
      emptyLabel="No stock has been received yet."
      searchPlaceholder="Search item or storage area…"
      exportName="stock-summary"
      actions={(r) => (
        <Link
          href={`/admin/stock-manager?tab=transactions&item=${r.item_id}&area=${r.storage_area_id}`}
          className={linkButtonClass}
        >
          History
        </Link>
      )}
    />
  );
}

export function Transactions({ rows, options, timeZone }: { rows: LedgerRow[]; options: Options; timeZone: string }) {
  const columns: Column<LedgerRow>[] = [
    {
      key: "date",
      label: "Date",
      render: (r) => formatDateTime(r.transaction_date, timeZone),
      text: (r) => formatDateTime(r.transaction_date, timeZone),
      sortValue: (r) => r.transaction_date,
    },
    {
      key: "type",
      label: "Type",
      render: (r) => TRANSACTION_TYPE_LABELS[r.transaction_type] ?? r.transaction_type,
      text: (r) => TRANSACTION_TYPE_LABELS[r.transaction_type] ?? r.transaction_type,
    },
    { key: "item", label: "Item", render: (r) => labelOf(options, "items", r.item_id), text: (r) => labelOf(options, "items", r.item_id) },
    { key: "area", label: "Storage area", render: (r) => labelOf(options, "storageAreas", r.storage_area_id), text: (r) => labelOf(options, "storageAreas", r.storage_area_id) },
    {
      key: "qty",
      label: "Qty",
      render: (r) => (
        <span className={r.qty < 0 ? "text-danger" : "text-success"}>
          {r.qty > 0 ? "+" : ""}
          {formatQty(r.qty)}
        </span>
      ),
      text: (r) => r.qty,
      className: num,
    },
    { key: "base", label: "Qty (default unit)", render: (r) => formatQty(r.base_qty), text: (r) => r.base_qty, className: num },
  ];
  return (
    <DataTable
      rows={rows}
      columns={columns}
      getKey={(r) => r.id}
      emptyLabel="No stock movements."
      searchPlaceholder="Search movements…"
      exportName="stock-transactions"
    />
  );
}

// Overview of one document type; the number links to the document.
export function DocList({
  kind,
  rows,
  options,
  timeZone,
}: {
  kind: DocKind;
  rows: DocRow[];
  options: Options;
  timeZone: string;
}) {
  const cfg = DOC_CONFIG[kind];
  const number: Column<DocRow> = {
    key: "nr",
    label: "Number",
    render: (r) => (
      <Link href={`/admin/stock-manager/${kind}/${r.reference}`} className="font-semibold text-primary hover:text-primary-hover">
        {docNumber(kind, r.reference)}
      </Link>
    ),
    text: (r) => docNumber(kind, r.reference),
  };
  const date = (key: string, label: string, time: boolean): Column<DocRow> => {
    const text = (r: DocRow) => (time ? formatDateTime(r[key] as string, timeZone) : formatDate(r[key] as string, timeZone));
    return { key, label, render: text, text, sortValue: (r) => r[key] as string | null };
  };
  const area = (key: string, label: string): Column<DocRow> => {
    const text = (r: DocRow) => (r[key] ? labelOf(options, "storageAreas", r[key]) : "—");
    return { key, label, render: text, text };
  };
  const supplier: Column<DocRow> = {
    key: "supplier",
    label: "Supplier",
    render: (r) => (r.supplier_id ? labelOf(options, "suppliers", r.supplier_id) : "—"),
    text: (r) => (r.supplier_id ? labelOf(options, "suppliers", r.supplier_id) : ""),
  };
  const comment: Column<DocRow> = {
    key: "comment",
    label: "Comment",
    render: (r) => <span className="line-clamp-1">{(r.comment as string) ?? ""}</span>,
    text: (r) => (r.comment as string) ?? "",
  };

  const byKind: Record<DocKind, Column<DocRow>[]> = {
    "purchase-orders": [
      number,
      date("order_date", "Order date", false),
      supplier,
      { key: "alias", label: "Alias", render: (r) => (r.order_alias as string) ?? "—", text: (r) => (r.order_alias as string) ?? "" },
      { key: "status", label: "Status", render: (r) => <PoStatusBadge status={r.status as string} />, text: (r) => r.status as string },
      { key: "items", label: "Lines", render: (r) => r.nr_of_items, text: (r) => r.nr_of_items as number, className: num },
      { key: "total", label: "Total inc. VAT", render: (r) => formatMoney(r.total_cost_inc_vat), text: (r) => r.total_cost_inc_vat as number, className: num },
    ],
    loads: [number, date("load_date", "Date", false), comment],
    intakes: [
      number,
      {
        key: "load",
        label: "Load",
        render: (r) => {
          const ref = (r.load as { reference: number }).reference;
          return (
            <Link href={`/admin/stock-manager/loads/${ref}`} className="text-primary hover:text-primary-hover">
              {docNumber("loads", ref)}
            </Link>
          );
        },
        text: (r) => docNumber("loads", (r.load as { reference: number }).reference),
      },
      area("storage_area_id", "Storage area"),
      supplier,
    ],
    transfers: [
      number,
      date("transfer_date", "Date", true),
      {
        key: "type",
        label: "Type",
        render: (r) => TRANSFER_TYPE_LABELS[r.transfer_type as string],
        text: (r) => TRANSFER_TYPE_LABELS[r.transfer_type as string],
      },
      area("from_storage_area_id", "From"),
      area("to_storage_area_id", "To"),
    ],
    "work-orders": [number, date("order_date", "Date", true), area("storage_area_id", "Storage area"), comment],
    "stock-takes": [number, date("take_date", "Date", true), area("storage_area_id", "Storage area"), comment],
  };

  return (
    <DataTable
      rows={rows}
      columns={byKind[kind]}
      getKey={(r) => r.id}
      emptyLabel={`No ${cfg.plural.toLowerCase()} yet.`}
      searchPlaceholder={`Search ${cfg.plural.toLowerCase()}…`}
      exportName={kind}
    />
  );
}
