// Stock documents (spec "Screens" → Stock, Appendix A.5 and A.8): the header
// and all its lines saved together in one transaction with one outbox row,
// sent as one save_stock_document call.
import type { CommonPowerSyncDatabase } from "@powersync/react-native";
import type { StockKind } from "../domain/permissions";
import { nowIso } from "../domain/dates";
import { newId, queueCommand, resolveAttention } from "./outbox";
import type { StockPayload } from "./types";

export type FieldType = "text" | "textarea" | "number" | "date" | "datetime" | "select" | "bool";
export type OptionsKey = "storageAreas" | "items" | "transferTypes";

export type Field = {
  key: string;
  label: string;
  type: FieldType;
  options?: OptionsKey;
  required?: boolean;
  showWhen?: (values: Record<string, string>) => boolean;
  hint?: string;
};

export type StockConfig = {
  kind: StockKind;
  table: string;
  dateKey: string;
  dateHasTime: boolean;
  label: string;
  plural: string;
  title: string; // list header
  newTitle: string;
  prefix: string;
  header: Field[];
  line?: { table: string; fk: string; label: string; plural: string; fields: Field[] };
};

export const TRANSFER_TYPE_LABELS: Record<string, string> = {
  SEND: "Send",
  RECEIVE: "Receive",
  BOTH: "Send and receive",
};

// Copied from web/src/lib/stock-manager/docs.ts (DOC_CONFIG) for the four
// documents the field app creates.
export const STOCK_CONFIG: Record<StockKind, StockConfig> = {
  loads: {
    kind: "loads",
    table: "load",
    dateKey: "load_date",
    dateHasTime: false,
    label: "Load",
    plural: "Loads",
    title: "Intakes",
    newTitle: "Add New Load",
    prefix: "LD-",
    header: [
      { key: "load_date", label: "Date", type: "date", required: true },
      { key: "driver", label: "Driver", type: "text" },
      { key: "vehicle_reg_nr", label: "Vehicle reg nr", type: "text" },
      { key: "comment", label: "Comment", type: "textarea" },
    ],
  },
  transfers: {
    kind: "transfers",
    table: "transfer_main",
    dateKey: "transfer_date",
    dateHasTime: true,
    label: "Transfer",
    plural: "Transfers",
    title: "Transfers",
    newTitle: "New Transfer Main",
    prefix: "TR-",
    header: [
      { key: "transfer_type", label: "Type", type: "select", options: "transferTypes", required: true },
      { key: "transfer_date", label: "Date", type: "datetime", required: true },
      { key: "from_storage_area_id", label: "From storage area", type: "select", options: "storageAreas", showWhen: (v) => v.transfer_type !== "RECEIVE" },
      { key: "to_storage_area_id", label: "To storage area", type: "select", options: "storageAreas", showWhen: (v) => v.transfer_type !== "SEND" },
      { key: "comment", label: "Comment", type: "textarea" },
    ],
    line: {
      table: "transfer_item",
      fk: "transfer_id",
      label: "Line",
      plural: "Lines",
      fields: [
        { key: "item_id", label: "Item", type: "select", options: "items", required: true },
        { key: "qty", label: "Qty", type: "number", required: true },
      ],
    },
  },
  "work-orders": {
    kind: "work-orders",
    table: "work_order",
    dateKey: "order_date",
    dateHasTime: true,
    label: "Work order",
    plural: "Work orders",
    title: "Work orders",
    newTitle: "New Work Order",
    prefix: "WO-",
    header: [
      { key: "storage_area_id", label: "Storage area", type: "select", options: "storageAreas", required: true },
      { key: "order_date", label: "Date", type: "datetime", required: true },
      { key: "comment", label: "Comment", type: "textarea" },
    ],
    line: {
      table: "work_order_item",
      fk: "work_order_id",
      label: "Line",
      plural: "Lines",
      fields: [
        { key: "item_id", label: "Item", type: "select", options: "items", required: true },
        { key: "qty", label: "Qty", type: "number", required: true },
        { key: "is_return", label: "Returned to stock", type: "bool", hint: "Leave off for stock used on the job (it comes off the storage area)." },
        { key: "transaction_date", label: "Date", type: "datetime", required: true },
      ],
    },
  },
  "stock-takes": {
    kind: "stock-takes",
    table: "stock_take",
    dateKey: "take_date",
    dateHasTime: true,
    label: "Stock take",
    plural: "Stock takes",
    title: "Stock takes",
    newTitle: "New Stock Take",
    prefix: "ST-",
    header: [
      { key: "storage_area_id", label: "Storage area", type: "select", options: "storageAreas", required: true },
      { key: "take_date", label: "Date", type: "datetime", required: true },
      { key: "comment", label: "Comment", type: "textarea" },
    ],
    line: {
      table: "stock_take_item",
      fk: "stock_take_id",
      label: "Counted line",
      plural: "Counted lines",
      fields: [
        { key: "item_id", label: "Item", type: "select", options: "items", required: true },
        { key: "counted_qty", label: "Counted qty", type: "number", required: true },
      ],
    },
  },
};

export const STOCK_KINDS: StockKind[] = ["loads", "transfers", "work-orders", "stock-takes"];

export function isStockKind(v: string): v is StockKind {
  return (STOCK_KINDS as string[]).includes(v);
}

export function docNumber(kind: StockKind, reference: number | null | undefined): string {
  if (reference === null || reference === undefined) return `${STOCK_CONFIG[kind].prefix}(new)`;
  return `${STOCK_CONFIG[kind].prefix}${String(reference).padStart(5, "0")}`;
}

// The PWA form's checks: required fields and numbers.
export function validateFields(fields: Field[], values: Record<string, string>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    if (f.showWhen && !f.showWhen(values)) continue;
    if (f.required && f.type !== "bool" && !values[f.key]?.trim()) errors[f.key] = "Required";
    else if (f.type === "number" && values[f.key]?.trim() && !Number.isFinite(Number(values[f.key]))) errors[f.key] = "Enter a number.";
  }
  return errors;
}

// Form text → the RPC's header / line keys. Hidden fields are cleared (the
// server also clears them for RECEIVE / SEND).
function toWire(fields: Field[], values: Record<string, string>): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const f of fields) {
    const raw = values[f.key] ?? "";
    if (f.showWhen && !f.showWhen(values)) {
      out[f.key] = null;
      continue;
    }
    if (f.type === "bool") out[f.key] = raw === "true";
    else if (f.type === "number") out[f.key] = raw.trim() === "" ? null : Number(raw);
    else out[f.key] = raw.trim() === "" ? null : raw;
  }
  return out;
}

export type StockLineInput = { key: string; values: Record<string, string> };

export async function saveStockDocument(
  db: CommonPowerSyncDatabase,
  kind: StockKind,
  headerValues: Record<string, string>,
  lines: StockLineInput[],
  opts: { userId: string; docId?: string; attentionId?: string | null },
): Promise<string> {
  const cfg = STOCK_CONFIG[kind];
  const capturedAt = nowIso();
  const id = opts.docId ?? newId();
  const header: Record<string, string | number | boolean | null> = { id, ...toWire(cfg.header, headerValues) };
  const wireLines: Record<string, string | number | boolean | null>[] = cfg.line
    ? lines.map((l) => ({ id: l.key, ...toWire(cfg.line!.fields, l.values) }))
    : [];
  const payload: StockPayload = { command_id: newId(), captured_at: capturedAt, kind, header, lines: wireLines };

  await db.writeTransaction(async (tx) => {
    const cols = ["id", ...cfg.header.map((f) => f.key), "created_by", "reference"];
    const vals = [id, ...cfg.header.map((f) => header[f.key] ?? null), opts.userId, null];
    if (kind === "loads") {
      cols.push("load_type");
      vals.push("INTAKE");
    }
    if (!(await tx.getOptional(`SELECT id FROM ${cfg.table} WHERE id = ?`, [id]))) {
      await tx.execute(`INSERT INTO ${cfg.table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, vals.map(sqlValue));
    }
    if (cfg.line) {
      for (const l of wireLines) {
        if (await tx.getOptional(`SELECT id FROM ${cfg.line.table} WHERE id = ?`, [l.id])) continue;
        const lineCols = ["id", cfg.line.fk, ...cfg.line.fields.map((f) => f.key)];
        const lineVals = [l.id, id, ...cfg.line.fields.map((f) => l[f.key] ?? null)];
        await tx.execute(
          `INSERT INTO ${cfg.line.table} (${lineCols.join(", ")}) VALUES (${lineCols.map(() => "?").join(", ")})`,
          lineVals.map(sqlValue),
        );
      }
    }
    await resolveAttention(tx, opts.attentionId);
    await queueCommand(tx, { command: "save_stock_document", payload }, capturedAt);
  });
  return id;
}

const sqlValue = (v: unknown) => (typeof v === "boolean" ? (v ? 1 : 0) : v);
