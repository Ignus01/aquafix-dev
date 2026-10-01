"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { friendlyError } from "@/lib/db-errors";
import { STOCK_READERS, STOCK_DOC_RIGHTS } from "@/lib/stock-manager/permissions";
import {
  DOC_CONFIG,
  PO_STATUS_LABELS,
  TRANSFER_TYPE_LABELS,
  isDocKind,
  type DocKind,
  type Field,
  type Options,
} from "@/lib/stock-manager/docs";
import type {
  DocData,
  DocFile,
  DocRow,
  LedgerRow,
  StockRow,
} from "@/lib/stock-manager/types";

// Same model as the other sections: every call runs with the caller's own
// session, so RLS and the database triggers are the real gate. These actions
// only shape data and give friendly errors.

const BUCKET = "stock-documents";
const DOWNLOAD_URL_TTL = 60;

type Result = { error: string | null };

function revalidate() {
  revalidatePath("/admin/stock-manager", "layout");
}

async function requireKind(kind: string, action: "read" | "create" | "update" | "delete" | "lineCreate" | "lineDelete") {
  if (!isDocKind(kind)) throw new Error("Unknown document type.");
  await requireRole(STOCK_DOC_RIGHTS[kind][action]);
  return kind as DocKind;
}

// ============================================================================
// Reads
// ============================================================================
export async function getOptions(): Promise<Options> {
  await requireRole(STOCK_READERS);
  const supabase = await createClient();
  const [suppliers, areas, items, pos] = await Promise.all([
    supabase.from("organisation").select("id, name").eq("is_supplier", true).order("name"),
    supabase.from("storage_area").select("id, code, name, active").order("name"),
    supabase.from("item").select("id, name, code, active").order("name"),
    supabase
      .from("purchase_order")
      .select("id, reference, status, supplier:supplier_id(name)")
      .order("reference", { ascending: false })
      .limit(500),
  ]);
  for (const r of [suppliers, areas, items, pos]) if (r.error) throw r.error;

  return {
    suppliers: (suppliers.data ?? []).map((o) => ({ value: o.id, label: o.name })),
    storageAreas: (areas.data ?? []).map((a) => ({ value: a.id, label: `${a.name} (${a.code})` })),
    items: (items.data ?? []).map((i) => ({ value: i.id, label: i.code ? `${i.name} — ${i.code}` : i.name })),
    purchaseOrders: ((pos.data ?? []) as unknown as { id: string; reference: number; status: string; supplier: { name: string } | null }[]).map(
      (p) => ({
        value: p.id,
        label: `${DOC_CONFIG["purchase-orders"].prefix}${String(p.reference).padStart(5, "0")} · ${p.supplier?.name ?? "—"} · ${PO_STATUS_LABELS[p.status] ?? p.status}`,
      }),
    ),
    transferTypes: Object.entries(TRANSFER_TYPE_LABELS).map(([value, label]) => ({ value, label })),
    poStatuses: Object.entries(PO_STATUS_LABELS).map(([value, label]) => ({ value, label })),
  };
}

export async function listDocuments(kind: DocKind): Promise<DocRow[]> {
  await requireKind(kind, "read");
  const supabase = await createClient();
  const cfg = DOC_CONFIG[kind];
  const { data, error } = await supabase
    .from(cfg.table)
    .select(kind === "intakes" ? "*, load:load_id(reference)" : "*")
    .order("reference", { ascending: false })
    .limit(500);
  if (error) throw error;
  return data as unknown as DocRow[];
}

async function listFiles(column: "load_id" | "intake_id", id: string): Promise<DocFile[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stock_document")
    .select("id, name, size_bytes, created_at")
    .eq(column, id)
    .order("created_at");
  if (error) throw error;
  return data as DocFile[];
}

export async function getDocument(kind: DocKind, reference: number): Promise<DocData | null> {
  await requireKind(kind, "read");
  const supabase = await createClient();
  const cfg = DOC_CONFIG[kind];

  const { data: header, error } = await supabase.from(cfg.table).select("*").eq("reference", reference).maybeSingle();
  if (error) throw error;
  if (!header) return null;
  const doc: DocData = { header: header as DocRow, lines: [] };

  if (cfg.line) {
    const { data: lines, error: linesError } = await supabase
      .from(cfg.line.table)
      .select("*")
      .eq(cfg.line.fk, header.id)
      .order("created_at");
    if (linesError) throw linesError;
    doc.lines = lines as DocRow[];
  }

  if (kind === "loads") {
    const { data: intakes, error: e } = await supabase
      .from("intake")
      .select("*")
      .eq("load_id", header.id)
      .order("reference");
    if (e) throw e;
    doc.intakes = intakes as DocRow[];
    doc.files = await listFiles("load_id", header.id);
  }

  if (kind === "intakes") {
    doc.files = await listFiles("intake_id", header.id);
    const { data: load, error: loadError } = await supabase.from("load").select("reference").eq("id", header.load_id).maybeSingle();
    if (loadError) throw loadError;
    doc.loadReference = load?.reference ?? null;

    // PO lines still to receive, and which are already on this intake.
    if (header.purchase_order_id) {
      const { data: poLines, error: e } = await supabase
        .from("purchase_order_item")
        .select("*")
        .eq("purchase_order_id", header.purchase_order_id)
        .order("created_at");
      if (e) throw e;
      doc.poLines = poLines as DocRow[];
      const { data: po } = await supabase.from("purchase_order").select("reference").eq("id", header.purchase_order_id).maybeSingle();
      doc.purchaseOrderReference = po?.reference ?? null;
    }
  }
  return doc;
}

// StorageAreaItemStock: stock on hand per item and storage area.
export async function listStock(): Promise<StockRow[]> {
  await requireRole(STOCK_READERS);
  const supabase = await createClient();
  const [stock, items, areas] = await Promise.all([
    supabase.from("storage_area_item_stock").select("item_id, storage_area_id, qty, base_qty"),
    supabase.from("item").select("id, name, code, product:product_id(uom:uom_id(code))"),
    supabase.from("storage_area").select("id, name, code"),
  ]);
  for (const r of [stock, items, areas]) if (r.error) throw r.error;

  const itemById = new Map((items.data as unknown as { id: string; name: string; code: string | null; product: { uom: { code: string } | null } | null }[]).map((i) => [i.id, i]));
  const areaById = new Map((areas.data ?? []).map((a) => [a.id, a]));
  return (stock.data ?? [])
    .map((s) => {
      const item = itemById.get(s.item_id);
      const area = areaById.get(s.storage_area_id);
      return {
        item_id: s.item_id,
        storage_area_id: s.storage_area_id,
        item_name: item?.name ?? "—",
        item_code: item?.code ?? null,
        storage_area_name: area ? `${area.name} (${area.code})` : "—",
        qty: Number(s.qty),
        base_qty: Number(s.base_qty),
        base_uom: item?.product?.uom?.code ?? "",
      };
    })
    .sort((a, b) => a.item_name.localeCompare(b.item_name) || a.storage_area_name.localeCompare(b.storage_area_name));
}

// The ledger itself, newest first. Spec: "no per-item stock ledger page".
export async function listTransactions(filter: { item?: string; area?: string }): Promise<LedgerRow[]> {
  await requireRole(STOCK_READERS);
  const supabase = await createClient();
  let q = supabase
    .from("item_transaction")
    .select("id, reference, transaction_type, qty, base_qty, transaction_date, item_id, storage_area_id")
    .order("transaction_date", { ascending: false })
    .order("reference", { ascending: false })
    .limit(300);
  if (filter.item) q = q.eq("item_id", filter.item);
  if (filter.area) q = q.eq("storage_area_id", filter.area);
  const { data, error } = await q;
  if (error) throw error;
  return data as LedgerRow[];
}

// ============================================================================
// Writes
// ============================================================================
type Values = Record<string, string>;

// Form strings -> column values. Hidden fields (showWhen false) are cleared.
function coerce(fields: Field[], values: Values, mode: "create" | "update"): { row: Record<string, unknown>; error?: string } {
  const row: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.readOnly || (mode === "update" && f.createOnly)) continue;
    const raw = (values[f.key] ?? "").trim();
    const visible = f.showWhen ? f.showWhen(values) : true;
    if (!visible) {
      row[f.key] = null;
      continue;
    }
    if (f.type === "bool") {
      row[f.key] = raw === "true";
      continue;
    }
    if (raw === "") {
      if (f.required) return { row, error: `${f.label} is required.` };
      // Optional numbers (unit costs) are left to the database's defaults.
      if (f.type !== "number") row[f.key] = null;
      continue;
    }
    if (f.type === "number") {
      const n = Number(raw);
      if (!Number.isFinite(n)) return { row, error: `${f.label} must be a number.` };
      row[f.key] = n;
    } else {
      row[f.key] = raw;
    }
  }
  return { row };
}

export async function saveHeader(
  kind: DocKind,
  id: string | null,
  values: Values,
  parent?: { loadReference?: number },
): Promise<Result & { id?: string; reference?: number }> {
  await requireKind(kind, id ? "update" : "create");
  const cfg = DOC_CONFIG[kind];
  const { row, error: invalid } = coerce(cfg.header, values, id ? "update" : "create");
  if (invalid) return { error: invalid };
  const supabase = await createClient();

  if (!id) {
    if (kind === "intakes") {
      const { data: load } = await supabase.from("load").select("id").eq("reference", parent?.loadReference ?? -1).maybeSingle();
      if (!load) return { error: "Choose the load this intake arrives on." };
      row.load_id = load.id;
      row.intake_type = "PURCHASE_ORDER";
      const { data: po } = await supabase.from("purchase_order").select("supplier_id").eq("id", row.purchase_order_id as string).maybeSingle();
      if (!po) return { error: "That purchase order no longer exists." };
      row.supplier_id = po.supplier_id;
    }
    const { data, error } = await supabase.from(cfg.table).insert(row).select("id, reference").single();
    if (error) return { error: friendlyError(error) };
    revalidate();
    return { error: null, id: data.id, reference: data.reference };
  }

  const { data, error } = await supabase.from(cfg.table).update(row).eq("id", id).select("id, reference");
  if (error) return { error: friendlyError(error) };
  if (!data || data.length === 0) return { error: "You don't have permission to change this." };
  revalidate();
  return { error: null, id, reference: data[0].reference };
}

export async function deleteDocument(kind: DocKind, id: string): Promise<Result> {
  await requireKind(kind, "delete");
  const supabase = await createClient();

  // Intakes and loads own uploaded files: take the objects with them.
  let paths: string[] = [];
  if (kind === "loads" || kind === "intakes") {
    const column = kind === "loads" ? "load_id" : "intake_id";
    const { data } = await supabase.from("stock_document").select("storage_path").eq(column, id);
    paths = (data ?? []).map((f) => f.storage_path);
  }
  const { data, error } = await supabase.from(DOC_CONFIG[kind].table).delete().eq("id", id).select("id");
  if (error) return { error: friendlyError(error) };
  if (!data || data.length === 0) return { error: "You don't have permission to delete this." };
  if (paths.length > 0) await supabase.storage.from(BUCKET).remove(paths);
  revalidate();
  return { error: null };
}

export async function saveLine(
  kind: DocKind,
  parentId: string,
  lineId: string | null,
  values: Values,
  extra?: { purchase_order_item_id?: string },
): Promise<Result> {
  await requireKind(kind, lineId ? "update" : "lineCreate");
  const line = DOC_CONFIG[kind].line;
  if (!line) return { error: "This document has no lines." };
  const { row, error: invalid } = coerce(line.fields, values, lineId ? "update" : "create");
  if (invalid) return { error: invalid };
  const supabase = await createClient();

  if (!lineId) {
    row[line.fk] = parentId;
    if (kind === "intakes" && extra?.purchase_order_item_id) {
      row.purchase_order_item_id = extra.purchase_order_item_id;
      delete row.item_id; // taken from the PO line
    }
    const { error } = await supabase.from(line.table).insert(row);
    if (error) return { error: friendlyError(error) };
  } else {
    const { data, error } = await supabase.from(line.table).update(row).eq("id", lineId).select("id");
    if (error) return { error: friendlyError(error) };
    if (!data || data.length === 0) return { error: "You don't have permission to change this line." };
  }
  revalidate();
  return { error: null };
}

export async function deleteLine(kind: DocKind, lineId: string): Promise<Result> {
  await requireKind(kind, "lineDelete");
  const line = DOC_CONFIG[kind].line;
  if (!line) return { error: "This document has no lines." };
  const supabase = await createClient();
  const { data, error } = await supabase.from(line.table).delete().eq("id", lineId).select("id");
  if (error) return { error: friendlyError(error) };
  if (!data || data.length === 0) return { error: "You don't have permission to delete this line." };
  revalidate();
  return { error: null };
}

// ============================================================================
// Documents (delivery notes, invoices) on loads and intakes
// ============================================================================
export async function addDocumentFile(
  parent: { kind: "loads" | "intakes"; id: string },
  file: { name: string; storage_path: string; mime_type: string | null; size_bytes: number },
): Promise<Result> {
  await requireKind(parent.kind, "update");
  const supabase = await createClient();
  const { error } = await supabase.from("stock_document").insert({
    ...(parent.kind === "loads" ? { load_id: parent.id } : { intake_id: parent.id }),
    ...file,
  });
  if (error) {
    await supabase.storage.from(BUCKET).remove([file.storage_path]);
    return { error: friendlyError(error) };
  }
  revalidate();
  return { error: null };
}

export async function getDocumentFileUrl(fileId: string): Promise<Result & { url?: string }> {
  await requireRole(STOCK_DOC_RIGHTS.intakes.read);
  const supabase = await createClient();
  const { data: file, error } = await supabase.from("stock_document").select("storage_path, name").eq("id", fileId).maybeSingle();
  if (error) return { error: friendlyError(error) };
  if (!file) return { error: "That file no longer exists." };
  const { data, error: urlError } = await supabase.storage.from(BUCKET).createSignedUrl(file.storage_path, DOWNLOAD_URL_TTL, { download: file.name });
  if (urlError || !data) return { error: "Couldn't prepare the download." };
  return { error: null, url: data.signedUrl };
}

export async function deleteDocumentFile(fileId: string): Promise<Result> {
  await requireRole(STOCK_DOC_RIGHTS.intakes.update);
  const supabase = await createClient();
  const { data, error } = await supabase.from("stock_document").delete().eq("id", fileId).select("storage_path");
  if (error) return { error: friendlyError(error) };
  if (!data || data.length === 0) return { error: "You don't have permission to delete this file." };
  await supabase.storage.from(BUCKET).remove(data.map((f) => f.storage_path));
  revalidate();
  return { error: null };
}
