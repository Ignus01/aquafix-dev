// A document header or line as the database returns it (select "*"). Columns
// differ per table, so values are read by key and cast where used.
export type DocRow = {
  id: string;
  reference: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [column: string]: any;
};

export type DocFile = { id: string; name: string; size_bytes: number; created_at: string };

export type DocData = {
  header: DocRow;
  lines: DocRow[];
  // Load: its intakes.
  intakes?: DocRow[];
  files?: DocFile[];
  // Intake: the load it arrives on and the purchase order's lines.
  loadReference?: number | null;
  purchaseOrderReference?: number | null;
  poLines?: DocRow[];
};

export type StockRow = {
  item_id: string;
  storage_area_id: string;
  item_name: string;
  item_code: string | null;
  storage_area_name: string;
  qty: number;
  base_qty: number;
  base_uom: string;
  // The earliest expiry of the batches still there.
  next_expiry: string | null;
  // Minimum level set for this item here (MWTS R6); low when on hand < min.
  min_qty: number | null;
  is_low: boolean;
};

export type LedgerRow = {
  id: string;
  reference: number;
  transaction_type: string;
  qty: number;
  base_qty: number;
  transaction_date: string;
  item_id: string;
  storage_area_id: string;
};

// Where a ledger row's stock came from: one entry per batch it moved.
export type BatchSource = {
  purchase_order_reference: number | null;
  source: string | null; // INTAKE, ADJUSTMENT, RETURN, UNTRACED; null = untraced
  batch_number: string | null;
  expiry_date: string | null;
  qty: number;
  value: number | null;
};

// The ledger rows of work-order usage carry the work order's site.
export type LedgerRowWithSite = LedgerRow & {
  location_id: string | null;
  work_order_reference: number | null;
  sources: BatchSource[];
  value: number | null;
};

// What happened to one purchase order's stock (PO page, "Where it went").
export type PoTraceRow = {
  key: string;
  kind: "on_hand" | "used" | "adjusted";
  date: string | null;
  item_id: string;
  storage_area_id: string;
  location_id: string | null;
  work_order_reference: number | null;
  batch_number: string | null;
  expiry_date: string | null;
  qty: number;
  value: number | null;
};

// One intake of a purchase order (the PO page's Receipts panel).
export type Receipt = {
  id: string;
  reference: number;
  intake_date: string;
  storage_area_id: string;
  delivery_note: string | null;
  invoice_number: string | null;
  load_reference: number | null;
  driver: string | null;
  qty: number;
};

// An open purchase order on the phone's Collect list.
export type CollectableOrder = {
  id: string;
  reference: number;
  order_date: string;
  order_alias: string | null;
  comment: string | null;
  collector_user_id: string | null;
  collect_from: "SUPPLIER" | "STORAGE_AREA" | null;
  collect_from_area_id: string | null;
  deliver_to_area_id: string | null;
  supplier_name: string;
  assigned_to_me: boolean;
  lines: {
    id: string;
    item_id: string;
    qty_ordered: number;
    qty_received: number;
    qty_outstanding: number;
    status: string;
    created_at: string;
  }[];
};
