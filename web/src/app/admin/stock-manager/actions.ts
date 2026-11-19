"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/supabase/select-all";
import { requireRole } from "@/lib/auth";
import { friendlyError } from "@/lib/db-errors";
import { todayInZone } from "@/lib/inspections/dates";
import { STOCK_READERS, STOCK_DOC_RIGHTS } from "@/lib/stock-manager/permissions";
import { SERVICE_TYPE_LABELS, type ServiceType } from "@/lib/services/types";
import {
  COLLECT_FROM_LABELS,
  DOC_CONFIG,
  PO_STATUS_LABELS,
  TRANSFER_TYPE_LABELS,
  isDocKind,
  type DocKind,
  type Field,
  type Options,
} from "@/lib/stock-manager/docs";
import type {
  CollectableOrder,
  DocData,
  DocFile,
  DocRow,
  LedgerRow,
  LedgerRowWithSite,
  PoTraceRow,
  Receipt,
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
  const [suppliers, areas, items, pos, collectors, sites, services, incidents] = await Promise.all([
    supabase.from("organisation").select("id, name, active").eq("is_supplier", true).order("name"),
    supabase.from("storage_area").select("id, code, name, active, technician_user_id, location:location_id(transfer_type)").order("name"),
    supabase.from("item").select("id, name, code, active").order("name"),
    supabase
      .from("purchase_order")
      .select("id, reference, status, supplier:supplier_id(name)")
      .order("reference", { ascending: false })
      .limit(500),
    supabase.rpc("list_stock_collectors"),
    supabase.from("location").select("id, name, active").order("name"),
    // Open services and incidents, for linking a work order to one (R4).
    supabase
      .from("service")
      .select("id, reference, service_type, due_date, asset:asset_id(name, location_id)")
      .eq("is_completed", false)
      .order("due_date")
      .limit(1000),
    supabase
      .from("incident")
      .select("id, reference, comment, location_id, type:incident_type_id(name)")
      .neq("status", "completed")
      .order("reference", { ascending: false })
      .limit(1000),
  ]);
  for (const r of [suppliers, areas, items, pos, collectors, sites, services, incidents]) if (r.error) throw r.error;

  return {
    // Inactive records stay in the lists so documents that use them still show
    // their names; the forms only offer the active ones (Mendix: [Active]).
    suppliers: (suppliers.data ?? []).map((o) => ({ value: o.id, label: o.name, inactive: !o.active })),
    storageAreas: ((areas.data ?? []) as unknown as { id: string; code: string; name: string; active: boolean; technician_user_id: string | null; location: { transfer_type: "AUTO" | "MANUAL" } | null }[]).map(
      (a) => ({
        value: a.id,
        label: `${a.name} (${a.code})`,
        inactive: !a.active,
        transferType: a.location?.transfer_type,
        technicianUserId: a.technician_user_id,
      }),
    ),
    items: (items.data ?? []).map((i) => ({
      value: i.id,
      label: i.code ? `${i.name} — ${i.code}` : i.name,
      inactive: !i.active,
    })),
    // An intake receives against an open purchase order (Mendix: [Status = '_NEW']).
    purchaseOrders: ((pos.data ?? []) as unknown as { id: string; reference: number; status: string; supplier: { name: string } | null }[]).map(
      (p) => ({
        value: p.id,
        label: `${DOC_CONFIG["purchase-orders"].prefix}${String(p.reference).padStart(5, "0")} · ${p.supplier?.name ?? "—"} · ${PO_STATUS_LABELS[p.status] ?? p.status}`,
        inactive: p.status !== "new",
      }),
    ),
    transferTypes: Object.entries(TRANSFER_TYPE_LABELS).map(([value, label]) => ({ value, label })),
    poStatuses: Object.entries(PO_STATUS_LABELS).map(([value, label]) => ({ value, label })),
    collectors: ((collectors.data ?? []) as { id: string; name: string }[]).map((u) => ({ value: u.id, label: u.name })),
    collectFrom: Object.entries(COLLECT_FROM_LABELS).map(([value, label]) => ({ value, label })),
    sites: (sites.data ?? []).map((l) => ({ value: l.id, label: l.name, inactive: !l.active })),
    services: ((services.data ?? []) as unknown as { id: string; reference: number; service_type: ServiceType; due_date: string; asset: { name: string; location_id: string } | null }[]).map(
      (sv) => ({
        value: sv.id,
        label: `${sv.asset?.name ?? "—"} · ${SERVICE_TYPE_LABELS[sv.service_type] ?? sv.service_type} · due ${sv.due_date.slice(0, 10)}`,
        locationId: sv.asset?.location_id,
      }),
    ),
    incidents: ((incidents.data ?? []) as unknown as { id: string; reference: number; comment: string; location_id: string; type: { name: string } | null }[]).map(
      (i) => ({
        value: i.id,
        label: `#${i.reference} · ${i.type?.name ?? "Incident"} · ${i.comment.length > 40 ? `${i.comment.slice(0, 40)}…` : i.comment}`,
        locationId: i.location_id,
      }),
    ),
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
  const rows = data as unknown as DocRow[];
  // Who made each document ("Created by" in the lists and exports).
  const ids = [...new Set(rows.map((r) => r.created_by as string | null).filter((v): v is string => !!v))];
  if (ids.length > 0) {
    const { data: names, error: namesError } = await supabase.rpc("get_user_names", { p_ids: ids });
    if (namesError) throw namesError;
    const byId = new Map(((names ?? []) as { id: string; name: string }[]).map((n) => [n.id, n.name]));
    for (const r of rows) r.created_by_name = r.created_by ? (byId.get(r.created_by as string) ?? null) : null;
  }
  return rows;
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
  const [stock, items, areas, expiries] = await Promise.all([
    selectAll(() =>
      supabase
        .from("storage_area_item_stock")
        .select("item_id, storage_area_id, qty, base_qty")
        .order("item_id")
        .order("storage_area_id"),
    ),
    selectAll(() => supabase.from("item").select("id, name, code, product:product_id(uom:uom_id(code))").order("id")),
    selectAll(() => supabase.from("storage_area").select("id, name, code").order("id")),
    selectAll(() => supabase.from("storage_area_stock").select("item_id, storage_area_id, next_expiry").not("next_expiry", "is", null).order("id")),
  ]);
  const expiry = new Map(expiries.map((e) => [`${e.item_id}:${e.storage_area_id}`, e.next_expiry as string]));

  const itemById = new Map((items as unknown as { id: string; name: string; code: string | null; product: { uom: { code: string } | null } | null }[]).map((i) => [i.id, i]));
  const areaById = new Map(areas.map((a) => [a.id, a]));
  return stock
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
        next_expiry: expiry.get(`${s.item_id}:${s.storage_area_id}`) ?? null,
      };
    })
    .sort((a, b) => a.item_name.localeCompare(b.item_name) || a.storage_area_name.localeCompare(b.storage_area_name));
}

// The ledger itself, newest first. Spec: "no per-item stock ledger page".
export async function listTransactions(filter: { item?: string; area?: string }): Promise<LedgerRowWithSite[]> {
  await requireRole(STOCK_READERS);
  const supabase = await createClient();
  let q = supabase
    .from("item_transaction")
    .select(
      "id, reference, transaction_type, qty, base_qty, transaction_date, item_id, storage_area_id, work_order_item:work_order_item_id(work_order:work_order_id(reference, location_id)), allocations:stock_allocation(qty, value_exc_vat, lot:lot_id(source, batch_number, expiry_date, po_item:purchase_order_item_id(purchase_order:purchase_order_id(reference))))",
    )
    .order("transaction_date", { ascending: false })
    .order("reference", { ascending: false })
    .limit(300);
  if (filter.item) q = q.eq("item_id", filter.item);
  if (filter.area) q = q.eq("storage_area_id", filter.area);
  const { data, error } = await q;
  if (error) throw error;
  type Alloc = {
    qty: number;
    value_exc_vat: number | null;
    lot: { source: string; batch_number: string | null; expiry_date: string | null; po_item: { purchase_order: { reference: number } | null } | null } | null;
  };
  return ((data ?? []) as unknown as (LedgerRow & {
    work_order_item: { work_order: { reference: number; location_id: string | null } | null } | null;
    allocations: Alloc[];
  })[]).map(({ work_order_item, allocations, ...r }) => {
    const sources = allocations.map((a) => ({
      purchase_order_reference: a.lot?.po_item?.purchase_order?.reference ?? null,
      source: a.lot?.source ?? null,
      batch_number: a.lot?.batch_number ?? null,
      expiry_date: a.lot?.expiry_date ?? null,
      qty: Number(a.qty),
      value: a.value_exc_vat === null ? null : Number(a.value_exc_vat),
    }));
    return {
      ...r,
      location_id: work_order_item?.work_order?.location_id ?? null,
      work_order_reference: work_order_item?.work_order?.reference ?? null,
      sources,
      value: sources.some((x) => x.value === null) ? null : sources.reduce((s, x) => s + (x.value ?? 0), 0),
    };
  });
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

  // Rules the web app applies and the database doesn't: the released phone
  // app saves loads and transfers without them (see 20261113120000).
  if (kind === "loads" && typeof row.load_date === "string") {
    const { data: tz } = await supabase.rpc("app_time_zone");
    if (row.load_date > todayInZone((tz as string | null) ?? "Africa/Johannesburg")) {
      return { error: "The load date can't be after today." };
    }
  }
  if (kind === "transfers") {
    if (row.from_storage_area_id === row.to_storage_area_id) {
      return { error: "The From and To storage areas must be different." };
    }
    // The destination's location decides the type. An existing transfer is
    // only held to it when its type or destination is being changed, so
    // editing an old one doesn't post stock it never moved.
    const { data: before } = id
      ? await supabase.from("transfer_main").select("transfer_type, to_storage_area_id").eq("id", id).maybeSingle()
      : { data: null };
    if (!before || before.transfer_type !== row.transfer_type || before.to_storage_area_id !== row.to_storage_area_id) {
      const { data: area } = await supabase
        .from("storage_area")
        .select("location:location_id(name, transfer_type)")
        .eq("id", row.to_storage_area_id as string)
        .maybeSingle();
      const location = (area as unknown as { location: { name: string; transfer_type: string } | null } | null)?.location;
      if (location?.transfer_type === "AUTO") row.transfer_type = "BOTH";
      else if (row.transfer_type === "BOTH") {
        return { error: `${location?.name ?? "That location"} receives transfers manually: choose Send or Receive.` };
      }
    }
  }

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

// ACT_PurchaseOrderItem_ChangeStatus: close a line that won't be received in
// full, or reopen a closed one. A completed line has nothing left to close.
// The database works out the order's status from its lines.
export async function togglePoLineClosed(lineId: string): Promise<Result> {
  await requireKind("purchase-orders", "update");
  const supabase = await createClient();
  const { data: line, error: readError } = await supabase
    .from("purchase_order_item")
    .select("status")
    .eq("id", lineId)
    .maybeSingle();
  if (readError) return { error: friendlyError(readError) };
  if (!line) return { error: "That line no longer exists." };
  if (line.status === "completed") return { error: "This line has been received in full, so it can't be closed." };
  const { data, error } = await supabase
    .from("purchase_order_item")
    .update({ status: line.status === "closed" ? "new" : "closed" })
    .eq("id", lineId)
    .select("id");
  if (error) return { error: friendlyError(error) };
  if (!data || data.length === 0) return { error: "You don't have permission to change this line." };
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
  await requireRole(STOCK_DOC_RIGHTS.intakes.delete);
  const supabase = await createClient();
  const { data, error } = await supabase.from("stock_document").delete().eq("id", fileId).select("storage_path");
  if (error) return { error: friendlyError(error) };
  if (!data || data.length === 0) return { error: "You don't have permission to delete this file." };
  await supabase.storage.from(BUCKET).remove(data.map((f) => f.storage_path));
  revalidate();
  return { error: null };
}

// ============================================================================
// Receiving a purchase order (MWTS spec R1, R3)
// ============================================================================

// The intakes of one purchase order, newest first, with what each received.
export async function listReceipts(purchaseOrderId: string): Promise<Receipt[]> {
  await requireRole(STOCK_DOC_RIGHTS.intakes.read);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("intake")
    .select("id, reference, intake_date, storage_area_id, delivery_note, invoice_number, load:load_id(reference, driver), lines:intake_item(qty)")
    .eq("purchase_order_id", purchaseOrderId)
    .order("intake_date", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as unknown as {
    id: string;
    reference: number;
    intake_date: string;
    storage_area_id: string;
    delivery_note: string | null;
    invoice_number: string | null;
    load: { reference: number; driver: string | null } | null;
    lines: { qty: number }[];
  }[]).map((r) => ({
    id: r.id,
    reference: r.reference,
    intake_date: r.intake_date,
    storage_area_id: r.storage_area_id,
    delivery_note: r.delivery_note,
    invoice_number: r.invoice_number,
    load_reference: r.load?.reference ?? null,
    driver: r.load?.driver ?? null,
    qty: r.lines.reduce((sum, l) => sum + Number(l.qty), 0),
  }));
}

export type ReceiveInput = {
  purchase_order_id: string;
  storage_area_id: string;
  driver?: string;
  vehicle_reg_nr?: string;
  delivery_note?: string;
  invoice_number?: string;
  comment?: string;
  lines: { purchase_order_item_id: string; qty: string; batch_number?: string; expiry_date?: string }[];
  documents?: { name: string; storage_path: string; mime_type: string | null; size_bytes: number }[];
};

// The signed-in user's name, as the driver of a load they receive.
export async function getCurrentUserDisplayName(): Promise<string> {
  await requireRole(STOCK_READERS);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("current_user_display_name");
  if (error) throw error;
  return (data as string | null) ?? "";
}

// One call makes the load, the PO intake and its lines (receive_purchase_order).
export async function receivePurchaseOrder(
  input: ReceiveInput,
): Promise<Result & { intakeReference?: number; loadReference?: number; status?: string }> {
  await requireRole(STOCK_DOC_RIGHTS.intakes.create);
  if (!input.storage_area_id) return { error: "Choose the storage area it goes into." };
  const lines = [];
  for (const l of input.lines) {
    const raw = l.qty.trim().replace(",", ".");
    const qty = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(qty) || qty < 0) return { error: "Each quantity must be a number of 0 or more." };
    lines.push({
      purchase_order_item_id: l.purchase_order_item_id,
      qty,
      batch_number: l.batch_number?.trim() || null,
      expiry_date: l.expiry_date?.trim() || null,
    });
  }
  if (!lines.some((l) => l.qty > 0)) return { error: "Enter a quantity for at least one line." };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("receive_purchase_order", {
    p: {
      purchase_order_id: input.purchase_order_id,
      storage_area_id: input.storage_area_id,
      driver: input.driver?.trim() || null,
      vehicle_reg_nr: input.vehicle_reg_nr?.trim() || null,
      delivery_note: input.delivery_note?.trim() || null,
      invoice_number: input.invoice_number?.trim() || null,
      comment: input.comment?.trim() || null,
      lines,
      documents: input.documents ?? [],
    },
  });
  if (error) {
    if (input.documents?.length) await supabase.storage.from(BUCKET).remove(input.documents.map((d) => d.storage_path));
    return { error: friendlyError(error) };
  }
  revalidate();
  revalidatePath("/m/stock", "layout");
  const res = data as { intake_reference: number; load_reference: number; purchase_order_status: string };
  return { error: null, intakeReference: res.intake_reference, loadReference: res.load_reference, status: res.purchase_order_status };
}

// Phone: open purchase orders this user can collect — assigned to them, or to
// nobody — with their open lines.
export async function listCollectable(): Promise<CollectableOrder[]> {
  await requireRole(STOCK_DOC_RIGHTS.intakes.create);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  const { data, error } = await supabase
    .from("purchase_order")
    .select(
      "id, reference, order_date, order_alias, comment, collector_user_id, collect_from, collect_from_area_id, deliver_to_area_id, supplier:supplier_id(name), lines:purchase_order_item(id, item_id, qty_ordered, qty_received, qty_outstanding, status, created_at)",
    )
    .eq("status", "new")
    .or(`collector_user_id.eq.${user.id},collector_user_id.is.null`)
    .order("reference");
  if (error) throw error;
  return ((data ?? []) as unknown as (Omit<CollectableOrder, "supplier_name" | "assigned_to_me"> & { supplier: { name: string } | null })[]).map(
    ({ supplier, lines, ...po }) => ({
      ...po,
      supplier_name: supplier?.name ?? "—",
      assigned_to_me: po.collector_user_id === user.id,
      lines: lines
        .filter((l) => l.status === "new")
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))),
    }),
  );
}

// ============================================================================
// Stock on hand for the phone (storage_area_stock, the ledger's running sum)
// ============================================================================
export type OnHand = { item_id: string; storage_area_id: string; qty: number; base_qty: number; next_expiry: string | null };

export async function listOnHand(): Promise<OnHand[]> {
  await requireRole(STOCK_READERS);
  const supabase = await createClient();
  const rows = await selectAll(() =>
    supabase.from("storage_area_stock").select("item_id, storage_area_id, qty, base_qty, next_expiry").neq("qty", 0).order("id"),
  );
  return rows.map((r) => ({ ...r, qty: Number(r.qty), base_qty: Number(r.base_qty) }));
}

// The signed-in user's id (to find their kit among the storage areas).
export async function getCurrentUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

// ============================================================================
// Traceability: where one purchase order's stock is now, and where it was used
// ============================================================================
export async function listPurchaseOrderTrace(purchaseOrderId: string): Promise<PoTraceRow[]> {
  await requireRole(STOCK_READERS);
  const supabase = await createClient();
  const { data: lots, error } = await supabase
    .from("stock_lot")
    .select("id, item_id, batch_number, expiry_date, po_item:purchase_order_item_id!inner(purchase_order_id)")
    .eq("po_item.purchase_order_id", purchaseOrderId);
  if (error) throw error;
  const lotById = new Map(((lots ?? []) as unknown as { id: string; item_id: string; batch_number: string | null; expiry_date: string | null }[]).map((l) => [l.id, l]));
  if (lotById.size === 0) return [];
  const ids = [...lotById.keys()];

  const [balances, moves] = await Promise.all([
    supabase.from("stock_lot_balance").select("lot_id, storage_area_id, qty, value_exc_vat").in("lot_id", ids).neq("qty", 0),
    supabase
      .from("stock_allocation")
      .select(
        "id, lot_id, storage_area_id, qty, value_exc_vat, tx:item_transaction_id!inner(transaction_type, transaction_date, work_order_item:work_order_item_id(work_order:work_order_id(reference, location_id)))",
      )
      .in("lot_id", ids)
      .in("tx.transaction_type", ["WORK_ORDER_USAGE", "WORK_ORDER_RETURN", "STOCK_ADJUSTMENT"]),
  ]);
  if (balances.error) throw balances.error;
  if (moves.error) throw moves.error;

  const rows: PoTraceRow[] = [];
  for (const b of (balances.data ?? []) as { lot_id: string; storage_area_id: string; qty: number; value_exc_vat: number | null }[]) {
    const lot = lotById.get(b.lot_id)!;
    rows.push({
      key: `on:${b.lot_id}:${b.storage_area_id}`,
      kind: "on_hand",
      date: null,
      item_id: lot.item_id,
      storage_area_id: b.storage_area_id,
      location_id: null,
      work_order_reference: null,
      batch_number: lot.batch_number,
      expiry_date: lot.expiry_date,
      qty: Number(b.qty),
      value: b.value_exc_vat === null ? null : Number(b.value_exc_vat),
    });
  }
  type Move = {
    id: string;
    lot_id: string;
    storage_area_id: string;
    qty: number;
    value_exc_vat: number | null;
    tx: { transaction_type: string; transaction_date: string; work_order_item: { work_order: { reference: number; location_id: string | null } | null } | null };
  };
  for (const m of (moves.data ?? []) as unknown as Move[]) {
    const lot = lotById.get(m.lot_id)!;
    const wo = m.tx.work_order_item?.work_order ?? null;
    rows.push({
      key: m.id,
      kind: m.tx.transaction_type === "STOCK_ADJUSTMENT" ? "adjusted" : "used",
      date: m.tx.transaction_date,
      item_id: lot.item_id,
      storage_area_id: m.storage_area_id,
      location_id: wo?.location_id ?? null,
      work_order_reference: wo?.reference ?? null,
      batch_number: lot.batch_number,
      expiry_date: lot.expiry_date,
      qty: Number(m.qty),
      value: m.value_exc_vat === null ? null : Number(m.value_exc_vat),
    });
  }
  return rows.sort((a, b) => (a.kind === "on_hand" ? 0 : 1) - (b.kind === "on_hand" ? 0 : 1) || String(b.date).localeCompare(String(a.date)));
}
