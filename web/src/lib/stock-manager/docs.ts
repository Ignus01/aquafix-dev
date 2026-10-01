// Description of the stock documents: which table holds each, what its header
// and lines contain and how they are numbered. The detail page, the editor and
// the server actions all read from here, so a document type is defined once.

export type DocKind =
  | "purchase-orders"
  | "loads"
  | "intakes"
  | "transfers"
  | "work-orders"
  | "stock-takes";

export type OptionsKey =
  | "suppliers"
  | "storageAreas"
  | "items"
  | "purchaseOrders"
  | "transferTypes"
  | "poStatuses";

export type Option = { value: string; label: string };
export type Options = Record<OptionsKey, Option[]>;

export type FieldType = "text" | "textarea" | "number" | "date" | "datetime" | "select" | "bool";

export type Field = {
  key: string;
  label: string;
  type: FieldType;
  options?: OptionsKey;
  required?: boolean;
  // Only asked for when the document is created (the database won't let it change).
  createOnly?: boolean;
  // Shown in the table but never edited (derived or fixed by the database).
  readOnly?: boolean;
  // Hide (and clear) the field unless this holds for the other values.
  showWhen?: (values: Record<string, string>) => boolean;
  hint?: string;
};

export type Extra = { key: string; label: string; kind?: "number" | "money" | "status" };

export type DocConfig = {
  kind: DocKind;
  table: string;
  label: string;
  plural: string;
  prefix: string;
  header: Field[];
  // Read-only header values shown beside the form.
  headerExtras: Extra[];
  line?: {
    table: string;
    fk: string;
    label: string;
    plural: string;
    fields: Field[];
    extras: Extra[];
    // Lines are added from elsewhere on the page, not with the generic form.
    noAdd?: boolean;
    fixed?: Record<string, unknown>;
  };
};

export const DOC_KINDS: DocKind[] = [
  "purchase-orders",
  "loads",
  "intakes",
  "transfers",
  "work-orders",
  "stock-takes",
];

export function isDocKind(v: string): v is DocKind {
  return (DOC_KINDS as string[]).includes(v);
}

export function docNumber(kind: DocKind, reference: number | string): string {
  return `${DOC_CONFIG[kind].prefix}${String(reference).padStart(5, "0")}`;
}

export const DOC_CONFIG: Record<DocKind, DocConfig> = {
  "purchase-orders": {
    kind: "purchase-orders",
    table: "purchase_order",
    label: "Purchase order",
    plural: "Purchase orders",
    prefix: "PO-",
    header: [
      { key: "supplier_id", label: "Supplier", type: "select", options: "suppliers", required: true },
      { key: "order_date", label: "Order date", type: "date", required: true },
      { key: "order_alias", label: "Alias", type: "text" },
      { key: "comment", label: "Comment", type: "textarea" },
    ],
    headerExtras: [
      { key: "status", label: "Status", kind: "status" },
      { key: "nr_of_items", label: "Lines", kind: "number" },
      { key: "total_cost_exc_vat", label: "Total exc. VAT", kind: "money" },
      { key: "total_cost_inc_vat", label: "Total inc. VAT", kind: "money" },
    ],
    line: {
      table: "purchase_order_item",
      fk: "purchase_order_id",
      label: "Line",
      plural: "Lines",
      fields: [
        { key: "item_id", label: "Item", type: "select", options: "items", required: true },
        { key: "qty_ordered", label: "Qty ordered", type: "number", required: true },
        { key: "unit_cost_exc_vat", label: "Unit cost exc. VAT", type: "number" },
        {
          key: "unit_cost_inc_vat",
          label: "Unit cost inc. VAT",
          type: "number",
          hint: "Change either price; the other follows the VAT rate.",
        },
        { key: "eta", label: "ETA", type: "date" },
        {
          key: "status",
          label: "Status",
          type: "select",
          options: "poStatuses",
          hint: "Close a line to stop expecting the rest of it. Received lines complete on their own.",
        },
      ],
      extras: [
        { key: "qty_received", label: "Received", kind: "number" },
        { key: "qty_outstanding", label: "Outstanding", kind: "number" },
        { key: "total_cost_inc_vat", label: "Total inc. VAT", kind: "money" },
      ],
    },
  },

  loads: {
    kind: "loads",
    table: "load",
    label: "Load",
    plural: "Loads",
    prefix: "LD-",
    header: [
      { key: "load_date", label: "Date", type: "date", required: true },
      { key: "driver", label: "Driver", type: "text" },
      { key: "vehicle_reg_nr", label: "Vehicle reg nr", type: "text" },
      { key: "comment", label: "Comment", type: "textarea" },
    ],
    headerExtras: [],
  },

  intakes: {
    kind: "intakes",
    table: "intake",
    label: "Intake",
    plural: "Intakes",
    prefix: "IN-",
    header: [
      { key: "purchase_order_id", label: "Purchase order", type: "select", options: "purchaseOrders", required: true, createOnly: true },
      { key: "storage_area_id", label: "Receiving storage area", type: "select", options: "storageAreas", required: true },
      { key: "comment", label: "Comment", type: "textarea" },
    ],
    headerExtras: [],
    line: {
      table: "intake_item",
      fk: "intake_id",
      label: "Received line",
      plural: "Received lines",
      noAdd: true,
      fields: [
        { key: "item_id", label: "Item", type: "select", options: "items", readOnly: true },
        { key: "qty", label: "Qty received", type: "number", required: true },
        { key: "transaction_date", label: "Date", type: "datetime", required: true },
      ],
      extras: [],
    },
  },

  transfers: {
    kind: "transfers",
    table: "transfer_main",
    label: "Transfer",
    plural: "Transfers",
    prefix: "TR-",
    header: [
      { key: "transfer_type", label: "Type", type: "select", options: "transferTypes", required: true },
      { key: "transfer_date", label: "Date", type: "datetime", required: true },
      {
        key: "from_storage_area_id",
        label: "From storage area",
        type: "select",
        options: "storageAreas",
        showWhen: (v) => v.transfer_type !== "RECEIVE",
      },
      {
        key: "to_storage_area_id",
        label: "To storage area",
        type: "select",
        options: "storageAreas",
        showWhen: (v) => v.transfer_type !== "SEND",
      },
      { key: "comment", label: "Comment", type: "textarea" },
    ],
    headerExtras: [],
    line: {
      table: "transfer_item",
      fk: "transfer_id",
      label: "Line",
      plural: "Lines",
      fields: [
        { key: "item_id", label: "Item", type: "select", options: "items", required: true },
        { key: "qty", label: "Qty", type: "number", required: true },
      ],
      extras: [],
    },
  },

  "work-orders": {
    kind: "work-orders",
    table: "work_order",
    label: "Work order",
    plural: "Work orders",
    prefix: "WO-",
    header: [
      { key: "storage_area_id", label: "Storage area", type: "select", options: "storageAreas", required: true },
      { key: "order_date", label: "Date", type: "datetime", required: true },
      { key: "comment", label: "Comment", type: "textarea" },
    ],
    headerExtras: [],
    line: {
      table: "work_order_item",
      fk: "work_order_id",
      label: "Line",
      plural: "Lines",
      fields: [
        { key: "item_id", label: "Item", type: "select", options: "items", required: true },
        { key: "qty", label: "Qty", type: "number", required: true },
        {
          key: "is_return",
          label: "Returned to stock",
          type: "bool",
          hint: "Leave off for stock used on the job (it comes off the storage area).",
        },
        { key: "transaction_date", label: "Date", type: "datetime", required: true },
      ],
      extras: [],
    },
  },

  "stock-takes": {
    kind: "stock-takes",
    table: "stock_take",
    label: "Stock take",
    plural: "Stock takes",
    prefix: "ST-",
    header: [
      { key: "storage_area_id", label: "Storage area", type: "select", options: "storageAreas", required: true },
      { key: "take_date", label: "Date", type: "datetime", required: true },
      { key: "comment", label: "Comment", type: "textarea" },
    ],
    headerExtras: [],
    line: {
      table: "stock_take_item",
      fk: "stock_take_id",
      label: "Counted line",
      plural: "Counted lines",
      fields: [
        { key: "item_id", label: "Item", type: "select", options: "items", required: true },
        { key: "counted_qty", label: "Counted qty", type: "number", required: true },
      ],
      extras: [{ key: "adjustment_qty", label: "Adjustment", kind: "number" }],
    },
  },
};

export const TRANSFER_TYPE_LABELS: Record<string, string> = {
  SEND: "Send",
  RECEIVE: "Receive",
  BOTH: "Send and receive",
};

export const PO_STATUS_LABELS: Record<string, string> = {
  new: "New",
  completed: "Completed",
  closed: "Closed",
};

export const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  INTAKE_PURCHASE_ORDER: "PO intake",
  INTAKE_FACILITY: "Facility intake",
  INTAKE_STOCK_RETURN: "Stock return intake",
  DISPATCH_LOCATION_TRANSFER: "Dispatch: facility transfer",
  DISPATCH_SUPPLIER_RETURN: "Dispatch: supplier return",
  DISPATCH_SALES_ORDER: "Dispatch: sales order",
  STOCK_TRANSFER: "Transfer",
  STOCK_ADJUSTMENT: "Stock take adjustment",
  WORK_ORDER_RETURN: "Work order return",
  WORK_ORDER_USAGE: "Work order usage",
};
