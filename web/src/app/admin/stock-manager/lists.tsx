"use client";

import Link from "next/link";
import { formatDate, formatDateTime } from "@/lib/incidents/format";
import { changedFields } from "@/lib/grid/fields";
import type { GridField, GridSpec } from "@/lib/grid/types";
import {
  DOC_CONFIG,
  TRANSACTION_TYPE_LABELS,
  TRANSFER_TYPE_LABELS,
  docNumber,
  type DocKind,
  type Options,
} from "@/lib/stock-manager/docs";
import type { BatchSource, DocRow, LedgerRowWithSite, StockRow } from "@/lib/stock-manager/types";
import { changedByOptions, changedColumns, Dash, type Changed, type GridColumn } from "../grid/columns";
import { Grid } from "../grid/grid";
import type { RowMenuItem } from "../grid/row-menu";
import { PoStatusBadge, formatMoney, formatQty } from "./format";

function labelOf(options: Options, key: keyof Options, value: unknown): string {
  return options[key].find((o) => o.value === value)?.label ?? "—";
}

const toOptions = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));

function copyLink(href: string): RowMenuItem {
  return { label: "Copy link", onSelect: () => navigator.clipboard?.writeText(`${window.location.origin}${href}`) };
}

const historyHref = (r: StockRow) => `/admin/stock-manager?tab=transactions&item=${r.item_id}&area=${r.storage_area_id}`;

// Stock on hand: the sum of the ledger per item and storage area. The item
// opens its movements in that storage area.
const stockGrid: GridSpec = {
  id: "stock-summary",
  fields: [
    { key: "item", label: "Item", filter: "text" },
    { key: "code", label: "Item code", filter: "text" },
    { key: "area", label: "Storage area", filter: "choice" },
    { key: "qty", label: "On hand (packs)", filter: "number" },
    { key: "base", label: "On hand (default unit)", filter: "number" },
    { key: "expiry", label: "Next expiry", filter: "date" },
  ],
  defaultSort: { key: "item", desc: false },
  changedException: "Stock on hand is a sum of the ledger, not a record anyone edits.",
};

export function StockSummary({ rows, options, timeZone }: { rows: StockRow[]; options: Options; timeZone: string }) {
  const columns: GridColumn<StockRow>[] = [
    { key: "item", render: (r) => r.item_name, value: (r) => r.item_name },
    { key: "code", render: (r) => r.item_code ?? <Dash />, value: (r) => r.item_code },
    {
      key: "area",
      render: (r) => r.storage_area_name,
      value: (r) => r.storage_area_id,
      sortValue: (r) => r.storage_area_name,
    },
    {
      key: "qty",
      align: "right",
      render: (r) => <span className={r.qty < 0 ? "text-danger" : undefined}>{formatQty(r.qty)}</span>,
      value: (r) => r.qty,
    },
    { key: "base", align: "right", render: (r) => `${formatQty(r.base_qty)} ${r.base_uom}`, value: (r) => r.base_qty },
    {
      key: "expiry",
      render: (r) =>
        r.next_expiry ? (
          <span className={r.next_expiry < new Date().toISOString().slice(0, 10) ? "font-semibold text-danger" : undefined}>
            {formatDate(r.next_expiry, timeZone)}
          </span>
        ) : (
          <Dash />
        ),
      value: (r) => r.next_expiry,
    },
  ];
  return (
    <Grid
      mode="client"
      spec={stockGrid}
      rows={rows}
      columns={columns}
      getKey={(r) => `${r.item_id}:${r.storage_area_id}`}
      title="Stock on hand"
      timeZone={timeZone}
      rowHref={historyHref}
      rowLabel={(r) => `${r.item_name} in ${r.storage_area_name}`}
      rowMenu={(r) => [{ label: "Movements", href: historyHref(r) }]}
      options={{ area: options.storageAreas }}
      emptyLabel="No stock has been received yet."
    />
  );
}

// The ledger: written by posting documents, never edited, so it has no
// Changed columns; the movement date is its timestamp.
const transactionsGrid: GridSpec = {
  id: "stock-transactions",
  fields: [
    { key: "reference", label: "Ref", filter: "number" },
    { key: "date", label: "Date", filter: "datetime" },
    { key: "type", label: "Type", filter: "choice", options: toOptions(TRANSACTION_TYPE_LABELS) },
    { key: "item", label: "Item", filter: "choice" },
    { key: "area", label: "Storage area", filter: "choice" },
    { key: "site", label: "Site", filter: "choice" },
    { key: "qty", label: "Qty", filter: "number" },
    { key: "base", label: "Qty (default unit)", filter: "number", hideable: true },
    { key: "from", label: "Came from", filter: "text" },
    { key: "value", label: "Value exc. VAT", filter: "number" },
  ],
  defaultSort: { key: "date", desc: true },
  changedException: "Ledger rows are written once when a document posts and never change.",
};

export function Transactions({ rows, options, timeZone }: { rows: LedgerRowWithSite[]; options: Options; timeZone: string }) {
  const columns: GridColumn<LedgerRowWithSite>[] = [
    { key: "reference", render: (r) => r.reference, value: (r) => r.reference },
    {
      key: "date",
      render: (r) => <span className="tabular-nums">{formatDateTime(r.transaction_date, timeZone)}</span>,
      value: (r) => r.transaction_date,
    },
    {
      key: "type",
      render: (r) => TRANSACTION_TYPE_LABELS[r.transaction_type] ?? r.transaction_type,
      value: (r) => r.transaction_type,
      sortValue: (r) => TRANSACTION_TYPE_LABELS[r.transaction_type] ?? r.transaction_type,
    },
    {
      key: "item",
      render: (r) => labelOf(options, "items", r.item_id),
      value: (r) => r.item_id,
      sortValue: (r) => labelOf(options, "items", r.item_id),
    },
    {
      key: "area",
      render: (r) => labelOf(options, "storageAreas", r.storage_area_id),
      value: (r) => r.storage_area_id,
      sortValue: (r) => labelOf(options, "storageAreas", r.storage_area_id),
    },
    {
      // Work-order usage and returns: the work order's site (MWTS spec R4).
      key: "site",
      render: (r) =>
        r.location_id ? (
          <Link href={`/admin/stock-manager/work-orders/${r.work_order_reference}`} className="text-primary hover:text-primary-hover">
            {labelOf(options, "sites", r.location_id)}
          </Link>
        ) : (
          <Dash />
        ),
      value: (r) => r.location_id,
      sortValue: (r) => (r.location_id ? labelOf(options, "sites", r.location_id) : null),
    },
    {
      key: "qty",
      align: "right",
      render: (r) => (
        <span className={r.qty < 0 ? "text-danger" : "text-success"}>
          {r.qty > 0 ? "+" : ""}
          {formatQty(r.qty)}
        </span>
      ),
      value: (r) => r.qty,
    },
    { key: "base", align: "right", render: (r) => formatQty(r.base_qty), value: (r) => r.base_qty },
    {
      // The batches this movement took or brought, oldest batch first.
      key: "from",
      render: (r) =>
        r.sources.length === 0 ? (
          <Dash />
        ) : (
          <span className="flex flex-col gap-0.5">
            {r.sources.map((s, i) => (
              <span key={i} className="whitespace-nowrap">
                {sourceLabel(s)}
                {r.sources.length > 1 && <span className="text-muted"> × {formatQty(Math.abs(s.qty))}</span>}
              </span>
            ))}
          </span>
        ),
      value: (r) => r.sources.map(sourceLabel),
    },
    {
      key: "value",
      align: "right",
      render: (r) => (r.value === null ? <Dash /> : formatMoney(r.value)),
      value: (r) => r.value,
    },
  ];
  return (
    <Grid
      mode="client"
      spec={transactionsGrid}
      rows={rows}
      columns={columns}
      getKey={(r) => r.id}
      title="Movements"
      timeZone={timeZone}
      rowLabel={(r) => `movement ${r.reference}`}
      options={{ item: options.items, area: options.storageAreas, site: options.sites }}
      emptyLabel="No stock movements."
    />
  );
}

// "PO-00004 · batch B12 · exp 31 Jan 2027"; stock with no receipt says why.
export function sourceLabel(s: BatchSource): string {
  const origin =
    s.purchase_order_reference !== null
      ? docNumber("purchase-orders", s.purchase_order_reference)
      : s.source === "ADJUSTMENT"
        ? "Stock-take surplus"
        : s.source === "RETURN"
          ? "Returned to stock"
          : "Untraced";
  return [origin, s.batch_number && `batch ${s.batch_number}`, s.expiry_date && `exp ${s.expiry_date}`].filter(Boolean).join(" · ");
}

type Doc = DocRow & Changed;

// One column of a document list: its spec field and its cell.
type DocCol = { field: GridField; column: GridColumn<Doc> };

// Overview of one document type; the number opens the document.
export function DocList({
  kind,
  rows,
  options,
  timeZone,
}: {
  kind: DocKind;
  rows: Doc[];
  options: Options;
  timeZone: string;
}) {
  const cfg = DOC_CONFIG[kind];
  const href = (r: Doc) => `/admin/stock-manager/${kind}/${r.reference}`;

  const number: DocCol = {
    field: { key: "nr", label: "Number", filter: "number" },
    column: { key: "nr", render: (r) => docNumber(kind, r.reference), value: (r) => r.reference },
  };
  const date = (key: string, label: string, time: boolean): DocCol => ({
    field: { key, label, filter: time ? "datetime" : "date" },
    column: {
      key,
      render: (r) => (
        <span className="tabular-nums">
          {time ? formatDateTime(r[key] as string, timeZone) : formatDate(r[key] as string, timeZone)}
        </span>
      ),
      value: (r) => (r[key] as string | null) ?? null,
    },
  });
  const lookup = (key: string, label: string, list: keyof Options): DocCol => ({
    field: { key, label, filter: "choice" },
    column: {
      key,
      render: (r) => (r[key] ? labelOf(options, list, r[key]) : <Dash />),
      value: (r) => (r[key] as string | null) ?? null,
      sortValue: (r) => (r[key] ? labelOf(options, list, r[key]) : null),
    },
  });
  const comment: DocCol = {
    field: { key: "comment", label: "Comment", filter: "text", hideable: true },
    column: {
      key: "comment",
      render: (r) =>
        r.comment ? (
          <span className="line-clamp-1 max-w-[280px] text-muted" title={r.comment as string}>
            {r.comment as string}
          </span>
        ) : (
          <Dash />
        ),
      value: (r) => (r.comment as string | null) ?? null,
    },
  };
  const area = (key: string, label: string) => lookup(key, label, "storageAreas");
  const createdBy: DocCol = {
    field: { key: "created_by_name", label: "Created by", filter: "text" },
    column: {
      key: "created_by_name",
      render: (r) => (r.created_by_name as string | null) ?? <Dash />,
      value: (r) => (r.created_by_name as string | null) ?? null,
    },
  };
  const supplier = lookup("supplier_id", "Supplier", "suppliers");

  const byKind: Record<DocKind, DocCol[]> = {
    "purchase-orders": [
      number,
      date("order_date", "Order date", false),
      supplier,
      {
        field: { key: "alias", label: "Alias", filter: "text" },
        column: { key: "alias", render: (r) => (r.order_alias as string) || <Dash />, value: (r) => r.order_alias as string | null },
      },
      lookup("collector_user_id", "Collector", "collectors"),
      {
        field: { key: "status", label: "Status", filter: "choice", options: options.poStatuses },
        column: { key: "status", render: (r) => <PoStatusBadge status={r.status as string} />, value: (r) => r.status as string },
      },
      {
        field: { key: "items", label: "Lines", filter: "number" },
        column: { key: "items", align: "right", render: (r) => r.nr_of_items, value: (r) => Number(r.nr_of_items) },
      },
      {
        field: { key: "total", label: "Total inc. VAT", filter: "number" },
        column: {
          key: "total",
          align: "right",
          render: (r) => formatMoney(r.total_cost_inc_vat),
          value: (r) => (r.total_cost_inc_vat === null ? null : Number(r.total_cost_inc_vat)),
        },
      },
    ],
    loads: [
      number,
      date("load_date", "Date", false),
      {
        field: { key: "driver", label: "Driver", filter: "text" },
        column: { key: "driver", render: (r) => (r.driver as string) || <Dash />, value: (r) => r.driver as string | null },
      },
      comment,
    ],
    intakes: [
      number,
      {
        field: { key: "load", label: "Load", filter: "number" },
        column: {
          key: "load",
          render: (r) => {
            const ref = (r.load as { reference: number }).reference;
            return (
              <Link href={`/admin/stock-manager/loads/${ref}`} className="text-primary hover:text-primary-hover">
                {docNumber("loads", ref)}
              </Link>
            );
          },
          value: (r) => (r.load as { reference: number }).reference,
        },
      },
      date("intake_date", "Date", true),
      area("storage_area_id", "Storage area"),
      supplier,
      {
        field: { key: "delivery_note", label: "Delivery note", filter: "text", hideable: true },
        column: { key: "delivery_note", render: (r) => (r.delivery_note as string) || <Dash />, value: (r) => r.delivery_note as string | null },
      },
      {
        field: { key: "invoice_number", label: "Invoice", filter: "text", hideable: true },
        column: { key: "invoice_number", render: (r) => (r.invoice_number as string) || <Dash />, value: (r) => r.invoice_number as string | null },
      },
    ],
    transfers: [
      number,
      date("transfer_date", "Date", true),
      {
        field: { key: "type", label: "Type", filter: "choice", options: options.transferTypes },
        column: {
          key: "type",
          render: (r) => TRANSFER_TYPE_LABELS[r.transfer_type as string],
          value: (r) => r.transfer_type as string,
        },
      },
      area("from_storage_area_id", "From"),
      area("to_storage_area_id", "To"),
    ],
    "work-orders": [
      number,
      date("order_date", "Date", true),
      lookup("location_id", "Site", "sites"),
      area("storage_area_id", "Storage area"),
      createdBy,
      comment,
    ],
    "stock-takes": [number, date("take_date", "Date", true), area("storage_area_id", "Storage area"), comment],
  };

  const cols = byKind[kind];
  const spec: GridSpec = {
    id: `stock-${kind}`,
    fields: [...cols.map((c) => c.field), ...changedFields()],
    defaultSort: { key: "changed", desc: true },
  };

  return (
    <Grid
      mode="client"
      spec={spec}
      rows={rows}
      columns={[...cols.map((c) => c.column), ...changedColumns<Doc>(timeZone)]}
      getKey={(r) => r.id}
      title={cfg.plural}
      timeZone={timeZone}
      rowHref={href}
      rowLabel={(r) => docNumber(kind, r.reference)}
      rowMenu={(r) => [{ label: "Open", href: href(r) }, copyLink(href(r))]}
      options={{
        supplier_id: options.suppliers,
        storage_area_id: options.storageAreas,
        from_storage_area_id: options.storageAreas,
        to_storage_area_id: options.storageAreas,
        location_id: options.sites,
        collector_user_id: options.collectors,
        changed_by: changedByOptions(rows),
      }}
      emptyLabel={`No ${cfg.plural.toLowerCase()} yet.`}
    />
  );
}
