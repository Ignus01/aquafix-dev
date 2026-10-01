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
