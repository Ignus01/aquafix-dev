"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { friendlyError } from "@/lib/db-errors";
import type {
  Barcode,
  Item,
  PackType,
  Product,
  ProductType,
  StorageArea,
  SupplierItem,
  UnitOfMeasure,
  UomConversion,
} from "@/lib/stock/types";

type ActionResult = { error: string | null };
type CreateResult = ActionResult & { id?: string };

// Every action uses the caller's own session (RLS-enforced), not the
// service-role client — the database access matrix is the real gate. This
// just confirms the caller is signed in with *some* masterdata role.
async function requireAnyRole() {
  await requireRole(["system_admin", "admin", "user", "viewer"]);
}

const PATH = "/admin/stock";

const text = (v: string | undefined) => v?.trim() ?? "";
const flag = (v: string | undefined) => v === "true";

// "" is not a number: Number("") would be 0 and read as a value.
function positive(v: string | undefined): number | null {
  const n = v === undefined || v.trim() === "" ? NaN : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ============================================================================
// Product type
// ============================================================================
export async function listProductTypes(): Promise<ProductType[]> {
  await requireAnyRole();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_type")
    .select("id, legacy_uid, code, name, active")
    .order("name");
  if (error) throw error;
  return data;
}

function productTypeValues(v: Record<string, string>) {
  return { code: text(v.code), name: text(v.name), active: flag(v.active) };
}

export async function createProductType(v: Record<string, string>): Promise<CreateResult> {
  await requireAnyRole();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_type")
    .insert(productTypeValues(v))
    .select("id")
    .single();
  if (error) return { error: friendlyError(error) };
  revalidatePath(PATH);
  return { error: null, id: data.id };
}

export async function updateProductType(id: string, v: Record<string, string>): Promise<ActionResult> {
  await requireAnyRole();
  const supabase = await createClient();
  const { error } = await supabase.from("product_type").update(productTypeValues(v)).eq("id", id);
  if (error) return { error: friendlyError(error) };
  revalidatePath(PATH);
  return { error: null };
}

export async function deleteProductType(id: string): Promise<ActionResult> {
  await requireAnyRole();
  const supabase = await createClient();
  const { error } = await supabase.from("product_type").delete().eq("id", id);
  if (error) return { error: friendlyError(error) };
  revalidatePath(PATH);
  return { error: null };
}

// ============================================================================
// Unit of measure
// ============================================================================
export async function listUnitsOfMeasure(): Promise<UnitOfMeasure[]> {
  await requireAnyRole();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("unit_of_measure")
    .select("id, legacy_uid, code, name, uom_type, active")
    .order("code");
  if (error) throw error;
  return data;
}

function uomValues(v: Record<string, string>) {
  return {
    code: text(v.code),
    name: text(v.name),
    uom_type: v.uom_type as UnitOfMeasure["uom_type"],
    active: flag(v.active),
  };
}

export async function createUnitOfMeasure(v: Record<string, string>): Promise<CreateResult> {
  await requireAnyRole();
  if (!v.uom_type) return { error: "Type is required." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("unit_of_measure")
    .insert(uomValues(v))
    .select("id")
    .single();
  if (error) return { error: friendlyError(error) };
  revalidatePath(PATH);
  return { error: null, id: data.id };
}

export async function updateUnitOfMeasure(id: string, v: Record<string, string>): Promise<ActionResult> {
  await requireAnyRole();
  if (!v.uom_type) return { error: "Type is required." };
  const supabase = await createClient();
  const { error } = await supabase.from("unit_of_measure").update(uomValues(v)).eq("id", id);
  if (error) return { error: friendlyError(error) };
  revalidatePath(PATH);
  return { error: null };
}

export async function deleteUnitOfMeasure(id: string): Promise<ActionResult> {
  await requireAnyRole();
  const supabase = await createClient();
  const { error } = await supabase.from("unit_of_measure").delete().eq("id", id);
  if (error) return { error: friendlyError(error) };
  revalidatePath(PATH);
  return { error: null };
}

// ---- Conversions: "1 <from> = <conversion> <to>"; the database keeps the
// opposite direction in step (and removes it with this one). ----
export async function listConversions(fromUomId: string): Promise<UomConversion[]> {
  await requireAnyRole();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("unit_of_measure_conversion")
    .select("id, code, conversion, from_uom_id, to_uom_id, to_uom:unit_of_measure!to_uom_id(code, name)")
    .eq("from_uom_id", fromUomId)
    .order("code");
  if (error) throw error;
  return data as unknown as UomConversion[];
}

export async function createConversion(
  fromUomId: string,
  toUomId: string,
  conversion: string,
): Promise<ActionResult> {
  await requireAnyRole();
  if (!toUomId) return { error: "Convert to is required." };
  if (toUomId === fromUomId) return { error: "A unit of measure can't be converted to itself." };
  const factor = positive(conversion);
  if (factor === null) return { error: "Conversion must be greater than 0." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("unit_of_measure_conversion")
    .insert({ from_uom_id: fromUomId, to_uom_id: toUomId, conversion: factor });
  if (error) return { error: friendlyError(error) };
  revalidatePath(PATH);
  return { error: null };
}

export async function updateConversion(id: string, conversion: string): Promise<ActionResult> {
  await requireAnyRole();
  const factor = positive(conversion);
  if (factor === null) return { error: "Conversion must be greater than 0." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("unit_of_measure_conversion")
    .update({ conversion: factor })
    .eq("id", id);
  if (error) return { error: friendlyError(error) };
  revalidatePath(PATH);
  return { error: null };
}

export async function deleteConversion(id: string): Promise<ActionResult> {
  await requireAnyRole();
  const supabase = await createClient();
  const { error } = await supabase.from("unit_of_measure_conversion").delete().eq("id", id);
  if (error) return { error: friendlyError(error) };
  revalidatePath(PATH);
  return { error: null };
}

// ============================================================================
// Pack type
// ============================================================================
export async function listPackTypes(): Promise<PackType[]> {
  await requireAnyRole();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pack_type")
    .select("id, legacy_uid, name, qty, code, active, uom_id, uom:unit_of_measure!uom_id(code)")
    .order("name");
  if (error) throw error;
  return data as unknown as PackType[];
}

function packTypeValues(v: Record<string, string>) {
  return { name: text(v.name), qty: positive(v.qty), uom_id: v.uom_id || null, active: flag(v.active) };
}

function packTypeError(p: ReturnType<typeof packTypeValues>): string | null {
  if (!p.name) return "Name is required.";
  if (!p.uom_id) return "Unit of measure is required.";
  if (p.qty === null) return "Qty must be greater than 0.";
  return null;
}

export async function createPackType(v: Record<string, string>): Promise<CreateResult> {
  await requireAnyRole();
  const p = packTypeValues(v);
  const invalid = packTypeError(p);
  if (invalid) return { error: invalid };
  const supabase = await createClient();
  const { data, error } = await supabase.from("pack_type").insert(p).select("id").single();
  if (error) return { error: friendlyError(error) };
  revalidatePath(PATH);
  return { error: null, id: data.id };
}

export async function updatePackType(id: string, v: Record<string, string>): Promise<ActionResult> {
  await requireAnyRole();
  const p = packTypeValues(v);
  const invalid = packTypeError(p);
  if (invalid) return { error: invalid };
  const supabase = await createClient();
  // The database refreshes the codes and conversion factors of dependent items.
  const { error } = await supabase.from("pack_type").update(p).eq("id", id);
  if (error) return { error: friendlyError(error) };
  revalidatePath(PATH);
  return { error: null };
}

export async function deletePackType(id: string): Promise<ActionResult> {
  await requireAnyRole();
  const supabase = await createClient();
  const { error } = await supabase.from("pack_type").delete().eq("id", id);
  if (error) return { error: friendlyError(error) };
  revalidatePath(PATH);
  return { error: null };
}

// ============================================================================
// Storage area
// ============================================================================
export async function listStorageAreas(): Promise<StorageArea[]> {
  await requireAnyRole();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("storage_area")
    .select("id, legacy_uid, code, name, active, location_id, location:location(name)")
    .order("name");
  if (error) throw error;
  return data as unknown as StorageArea[];
}

function storageAreaValues(v: Record<string, string>) {
  return {
    code: text(v.code),
    name: text(v.name),
    location_id: v.location_id || null,
    active: flag(v.active),
  };
}

export async function createStorageArea(v: Record<string, string>): Promise<CreateResult> {
  await requireAnyRole();
  const p = storageAreaValues(v);
  if (!p.location_id) return { error: "Location is required." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("storage_area").insert(p).select("id").single();
  if (error) return { error: friendlyError(error) };
  revalidatePath(PATH);
  return { error: null, id: data.id };
}

export async function updateStorageArea(id: string, v: Record<string, string>): Promise<ActionResult> {
  await requireAnyRole();
  const p = storageAreaValues(v);
  if (!p.location_id) return { error: "Location is required." };
  const supabase = await createClient();
  const { error } = await supabase.from("storage_area").update(p).eq("id", id);
  if (error) return { error: friendlyError(error) };
  revalidatePath(PATH);
  return { error: null };
}

export async function deleteStorageArea(id: string): Promise<ActionResult> {
  await requireAnyRole();
  const supabase = await createClient();
  const { error } = await supabase.from("storage_area").delete().eq("id", id);
  if (error) return { error: friendlyError(error) };
  revalidatePath(PATH);
  return { error: null };
}

// ============================================================================
// Product
// ============================================================================
export async function listProducts(): Promise<Product[]> {
  await requireAnyRole();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product")
    .select(
      "id, legacy_uid, code, name, active, product_type_id, uom_id, product_type:product_type(name), uom:unit_of_measure!uom_id(code)",
    )
    .order("name");
  if (error) throw error;
  return data as unknown as Product[];
}

function productValues(v: Record<string, string>) {
  return {
    code: text(v.code),
    name: text(v.name),
    product_type_id: v.product_type_id || null,
    uom_id: v.uom_id || null,
    active: flag(v.active),
  };
}

function productError(p: ReturnType<typeof productValues>): string | null {
  if (!p.name) return "Name is required.";
  if (!p.code) return "Code is required.";
  if (!p.product_type_id) return "Product type is required.";
  if (!p.uom_id) return "Unit of measure is required.";
  return null;
}

// Creating is the "basic" save: a new product has no items yet, so the
// active-needs-an-item rule only applies when an existing product is saved.
export async function createProduct(v: Record<string, string>): Promise<CreateResult> {
  await requireAnyRole();
  const p = productValues(v);
  const invalid = productError(p);
  if (invalid) return { error: invalid };
  const supabase = await createClient();
  const { data, error } = await supabase.from("product").insert(p).select("id").single();
  if (error) return { error: friendlyError(error) };
  revalidatePath(PATH);
  return { error: null, id: data.id };
}

export async function updateProduct(id: string, v: Record<string, string>): Promise<ActionResult> {
  await requireAnyRole();
  const p = productValues(v);
  const invalid = productError(p);
  if (invalid) return { error: invalid };
  const supabase = await createClient();

  if (p.active) {
    const { count, error: countError } = await supabase
      .from("item")
      .select("id", { count: "exact", head: true })
      .eq("product_id", id)
      .eq("active", true);
    if (countError) return { error: friendlyError(countError) };
    if (!count) return { error: "At least one active Item is required." };
  }

  const { error } = await supabase.from("product").update(p).eq("id", id);
  if (error) return { error: friendlyError(error) };
  revalidatePath(PATH);
  return { error: null };
}

export async function deleteProduct(id: string): Promise<ActionResult> {
  await requireAnyRole();
  const supabase = await createClient();
  const { error } = await supabase.from("product").delete().eq("id", id);
  if (error) return { error: friendlyError(error) };
  revalidatePath(PATH);
  return { error: null };
}

// ============================================================================
// Item (a product in a pack type), with its barcodes and supplier terms
// ============================================================================
export async function listItems(productId: string): Promise<Item[]> {
  await requireAnyRole();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("item")
    .select(
      "id, legacy_uid, name, code, conversion_to_default_uom, item_tracking_method, active, product_id, pack_type_id, pack_type:pack_type(name, code)",
    )
    .eq("product_id", productId)
    .order("name");
  if (error) throw error;
  return data as unknown as Item[];
}

export async function getItem(id: string): Promise<Item | null> {
  await requireAnyRole();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("item")
    .select(
      "id, legacy_uid, name, code, conversion_to_default_uom, item_tracking_method, active, product_id, pack_type_id, pack_type:pack_type(name, code)",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as unknown as Item | null;
}

function itemValues(v: Record<string, string>) {
  return {
    name: text(v.name),
    pack_type_id: v.pack_type_id || null,
    item_tracking_method: (v.item_tracking_method || "FIFO") as Item["item_tracking_method"],
    active: flag(v.active),
  };
}

// The database derives the code and conversion factor, and rejects a pack
// whose unit has no conversion to the product's unit.
export async function createItem(productId: string, v: Record<string, string>): Promise<CreateResult> {
  await requireAnyRole();
  const p = itemValues(v);
  if (!p.name) return { error: "Name is required." };
  if (!p.pack_type_id) return { error: "Pack type is required." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("item")
    .insert({ ...p, product_id: productId })
    .select("id")
    .single();
  if (error) return { error: friendlyError(error) };
  revalidatePath(PATH);
  return { error: null, id: data.id };
}

export async function updateItem(id: string, v: Record<string, string>): Promise<ActionResult> {
  await requireAnyRole();
  const p = itemValues(v);
  if (!p.name) return { error: "Name is required." };
  if (!p.pack_type_id) return { error: "Pack type is required." };
  const supabase = await createClient();
  const { error } = await supabase.from("item").update(p).eq("id", id);
  if (error) return { error: friendlyError(error) };
  revalidatePath(PATH);
  return { error: null };
}

export async function deleteItem(id: string): Promise<ActionResult> {
  await requireAnyRole();
  const supabase = await createClient();
  const { error } = await supabase.from("item").delete().eq("id", id);
  if (error) return { error: friendlyError(error) };
  revalidatePath(PATH);
  return { error: null };
}

// ---- Barcodes ----
export async function listBarcodes(itemId: string): Promise<Barcode[]> {
  await requireAnyRole();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("barcode")
    .select("id, barcode, item_id")
    .eq("item_id", itemId)
    .order("barcode");
  if (error) throw error;
  return data;
}

export async function createBarcode(itemId: string, barcode: string): Promise<ActionResult> {
  await requireAnyRole();
  if (!text(barcode)) return { error: "Barcode is required." };
  const supabase = await createClient();
  const { error } = await supabase.from("barcode").insert({ item_id: itemId, barcode: text(barcode) });
  if (error) return { error: friendlyError(error) };
  return { error: null };
}

export async function deleteBarcode(id: string): Promise<ActionResult> {
  await requireAnyRole();
  const supabase = await createClient();
  const { error } = await supabase.from("barcode").delete().eq("id", id);
  if (error) return { error: friendlyError(error) };
  return { error: null };
}

// ---- Supplier items ----
export async function listSupplierItems(itemId: string): Promise<SupplierItem[]> {
  await requireAnyRole();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("supplier_item")
    .select(
      "id, is_default, default_lead_time, default_price_exc_vat, item_id, supplier_id, supplier:organisation!supplier_id(name)",
    )
    .eq("item_id", itemId)
    .order("created_at");
  if (error) throw error;
  return data as unknown as SupplierItem[];
}

function supplierItemError(
  v: Record<string, string>,
): { error: string } | { error?: undefined; price: number; lead: number } {
  if (!v.supplier_id) return { error: "Supplier is required." };
  const price = positive(v.default_price_exc_vat);
  if (price === null) return { error: "Price (excl. VAT) must be greater than 0." };
  const lead = positive(v.default_lead_time);
  if (lead === null) return { error: "Lead time must be greater than 0." };
  return { price, lead };
}

export async function createSupplierItem(itemId: string, v: Record<string, string>): Promise<ActionResult> {
  await requireAnyRole();
  const parsed = supplierItemError(v);
  if (parsed.error !== undefined) return { error: parsed.error };
  const supabase = await createClient();
  const { error } = await supabase.from("supplier_item").insert({
    item_id: itemId,
    supplier_id: v.supplier_id as string,
    default_price_exc_vat: parsed.price,
    default_lead_time: parsed.lead,
    is_default: flag(v.is_default),
  });
  if (error) return { error: friendlyError(error) };
  return { error: null };
}

export async function updateSupplierItem(id: string, v: Record<string, string>): Promise<ActionResult> {
  await requireAnyRole();
  const parsed = supplierItemError(v);
  if (parsed.error !== undefined) return { error: parsed.error };
  const supabase = await createClient();
  const { error } = await supabase
    .from("supplier_item")
    .update({
      supplier_id: v.supplier_id as string,
      default_price_exc_vat: parsed.price,
      default_lead_time: parsed.lead,
    })
    .eq("id", id);
  if (error) return { error: friendlyError(error) };
  return { error: null };
}

// The database clears the flag on the item's other supplier items.
export async function setDefaultSupplierItem(id: string): Promise<ActionResult> {
  await requireAnyRole();
  const supabase = await createClient();
  const { error } = await supabase.from("supplier_item").update({ is_default: true }).eq("id", id);
  if (error) return { error: friendlyError(error) };
  return { error: null };
}

export async function deleteSupplierItem(id: string): Promise<ActionResult> {
  await requireAnyRole();
  const supabase = await createClient();
  const { error } = await supabase.from("supplier_item").delete().eq("id", id);
  if (error) return { error: friendlyError(error) };
  return { error: null };
}
