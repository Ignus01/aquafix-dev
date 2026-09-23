"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { friendlyError } from "@/lib/db-errors";
import type {
  Region,
  Organisation,
  AssetType,
  Location,
  ColourContainer,
  Grading,
  Asset,
} from "@/lib/masterdata/types";

type ActionResult = { error: string | null };

// Every masterdata action uses the caller's own session (RLS-enforced), not
// the service-role client — the database access matrix is the real gate.
// This just confirms the caller is signed in with *some* masterdata role.
async function requireAnyMasterdataRole() {
  await requireRole(["system_admin", "admin", "user", "viewer"]);
}

// ============================================================================
// Region
// ============================================================================
export async function listRegions(): Promise<Region[]> {
  await requireAnyMasterdataRole();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("region")
    .select("id, legacy_uid, name, active")
    .order("name");
  if (error) throw error;
  return data;
}

export async function createRegion(
  values: Record<string, string>,
): Promise<ActionResult> {
  await requireAnyMasterdataRole();
  const supabase = await createClient();
  const { error } = await supabase.from("region").insert({
    name: values.name?.trim(),
    active: values.active === "true",
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/admin/masterdata");
  return { error: null };
}

export async function updateRegion(
  id: string,
  values: Record<string, string>,
): Promise<ActionResult> {
  await requireAnyMasterdataRole();
  const supabase = await createClient();
  const { error } = await supabase
    .from("region")
    .update({ name: values.name?.trim(), active: values.active === "true" })
    .eq("id", id);
  if (error) return { error: friendlyError(error) };
  revalidatePath("/admin/masterdata");
  return { error: null };
}

export async function deleteRegion(id: string): Promise<ActionResult> {
  await requireAnyMasterdataRole();
  const supabase = await createClient();
  const { error } = await supabase.from("region").delete().eq("id", id);
  if (error) return { error: friendlyError(error) };
  revalidatePath("/admin/masterdata");
  return { error: null };
}

// ============================================================================
// Organisation
// ============================================================================
export async function listOrganisations(): Promise<Organisation[]> {
  await requireAnyMasterdataRole();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organisation")
    .select("id, legacy_uid, name, active, is_supplier, is_service_supplier")
    .order("name");
  if (error) throw error;
  return data;
}

export async function createOrganisation(
  values: Record<string, string>,
): Promise<ActionResult> {
  await requireAnyMasterdataRole();
  const supabase = await createClient();
  const { error } = await supabase.from("organisation").insert({
    name: values.name?.trim(),
    active: values.active === "true",
    is_supplier: values.is_supplier === "true",
    is_service_supplier: values.is_service_supplier === "true",
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/admin/masterdata");
  return { error: null };
}

export async function updateOrganisation(
  id: string,
  values: Record<string, string>,
): Promise<ActionResult> {
  await requireAnyMasterdataRole();
  const supabase = await createClient();
  const { error } = await supabase
    .from("organisation")
    .update({
      name: values.name?.trim(),
      active: values.active === "true",
      is_supplier: values.is_supplier === "true",
      is_service_supplier: values.is_service_supplier === "true",
    })
    .eq("id", id);
  if (error) return { error: friendlyError(error) };
  revalidatePath("/admin/masterdata");
  return { error: null };
}

export async function deleteOrganisation(id: string): Promise<ActionResult> {
  await requireAnyMasterdataRole();
  const supabase = await createClient();
  const { error } = await supabase.from("organisation").delete().eq("id", id);
  if (error) return { error: friendlyError(error) };
  revalidatePath("/admin/masterdata");
  return { error: null };
}

// ============================================================================
// AssetType
// ============================================================================
export async function listAssetTypes(): Promise<AssetType[]> {
  await requireAnyMasterdataRole();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("asset_type")
    .select("id, legacy_uid, name, classification, active")
    .order("name");
  if (error) throw error;
  return data;
}

// Returns the new id so the drawer can stay open to allocate inspections.
export async function createAssetType(
  values: Record<string, string>,
): Promise<ActionResult & { id?: string }> {
  await requireAnyMasterdataRole();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("asset_type")
    .insert({
      name: values.name?.trim(),
      classification: values.classification || "OTHER",
      active: values.active === "true",
    })
    .select("id")
    .single();
  if (error) return { error: friendlyError(error) };
  revalidatePath("/admin/masterdata");
  return { error: null, id: data.id };
}

export async function updateAssetType(
  id: string,
  values: Record<string, string>,
): Promise<ActionResult> {
  await requireAnyMasterdataRole();
  const supabase = await createClient();
  const { error } = await supabase
    .from("asset_type")
    .update({
      name: values.name?.trim(),
      classification: values.classification || "OTHER",
      active: values.active === "true",
    })
    .eq("id", id);
  if (error) return { error: friendlyError(error) };
  revalidatePath("/admin/masterdata");
  return { error: null };
}

export async function deleteAssetType(id: string): Promise<ActionResult> {
  await requireAnyMasterdataRole();
  const supabase = await createClient();
  const { error } = await supabase.from("asset_type").delete().eq("id", id);
  if (error) return { error: friendlyError(error) };
  revalidatePath("/admin/masterdata");
  return { error: null };
}

// ============================================================================
// Location
// ============================================================================
export async function listLocations(): Promise<Location[]> {
  await requireAnyMasterdataRole();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("location")
    .select(
      "id, legacy_uid, name, active, transfer_type, is_stock_manager, is_asset_manager, region_id, organisation_id, region:region_id(name), organisation:organisation_id(name)",
    )
    .order("name");
  if (error) throw error;
  return data as unknown as Location[];
}

export async function createLocation(
  values: Record<string, string>,
): Promise<ActionResult> {
  await requireAnyMasterdataRole();
  const supabase = await createClient();
  const { error } = await supabase.from("location").insert({
    name: values.name?.trim(),
    active: values.active === "true",
    transfer_type: values.transfer_type || "AUTO",
    is_stock_manager: values.is_stock_manager === "true",
    is_asset_manager: values.is_asset_manager === "true",
    region_id: values.region_id || null,
    organisation_id: values.organisation_id || null,
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/admin/masterdata");
  return { error: null };
}

export async function updateLocation(
  id: string,
  values: Record<string, string>,
): Promise<ActionResult> {
  await requireAnyMasterdataRole();
  const supabase = await createClient();
  const { error } = await supabase
    .from("location")
    .update({
      name: values.name?.trim(),
      active: values.active === "true",
      transfer_type: values.transfer_type || "AUTO",
      is_stock_manager: values.is_stock_manager === "true",
      is_asset_manager: values.is_asset_manager === "true",
      region_id: values.region_id || null,
      organisation_id: values.organisation_id || null,
    })
    .eq("id", id);
  if (error) return { error: friendlyError(error) };
  revalidatePath("/admin/masterdata");
  return { error: null };
}

export async function deleteLocation(id: string): Promise<ActionResult> {
  await requireAnyMasterdataRole();
  const supabase = await createClient();
  const { error } = await supabase.from("location").delete().eq("id", id);
  if (error) return { error: friendlyError(error) };
  revalidatePath("/admin/masterdata");
  return { error: null };
}

// ============================================================================
// ColourContainer (supports Grading; not one of the six documented entities)
// ============================================================================
export async function listColourContainers(): Promise<ColourContainer[]> {
  await requireAnyMasterdataRole();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("colour_container")
    .select("id, name, hex_colour, class_name")
    .order("name");
  if (error) throw error;
  return data;
}

export async function createColourContainer(
  values: Record<string, string>,
): Promise<ActionResult> {
  await requireAnyMasterdataRole();
  const supabase = await createClient();
  const { error } = await supabase.from("colour_container").insert({
    name: values.name?.trim(),
    hex_colour: values.hex_colour?.trim() || null,
    class_name: values.class_name?.trim() || "",
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/admin/masterdata");
  return { error: null };
}

export async function deleteColourContainer(
  id: string,
): Promise<ActionResult> {
  await requireAnyMasterdataRole();
  const supabase = await createClient();
  const { error } = await supabase
    .from("colour_container")
    .delete()
    .eq("id", id);
  if (error) return { error: friendlyError(error) };
  revalidatePath("/admin/masterdata");
  return { error: null };
}

// ============================================================================
// Grading
// ============================================================================
export async function listGradings(): Promise<Grading[]> {
  await requireAnyMasterdataRole();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("grading")
    .select(
      "id, legacy_uid, name, priority, class_name, colour_container_id, colour_container:colour_container_id(name)",
    )
    .order("priority");
  if (error) throw error;
  return data as unknown as Grading[];
}

// GRD-R05: new Grading gets the next sequential priority (max + 1).
export async function createGrading(
  values: Record<string, string>,
): Promise<ActionResult> {
  await requireAnyMasterdataRole();
  const supabase = await createClient();

  const { data: top } = await supabase
    .from("grading")
    .select("priority")
    .order("priority", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextPriority = (top?.priority ?? 0) + 1;

  const { error } = await supabase.from("grading").insert({
    name: values.name?.trim(),
    priority: nextPriority,
    colour_container_id: values.colour_container_id || null,
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/admin/masterdata");
  return { error: null };
}

export async function updateGrading(
  id: string,
  values: Record<string, string>,
): Promise<ActionResult> {
  await requireAnyMasterdataRole();
  const supabase = await createClient();
  const { error } = await supabase
    .from("grading")
    .update({
      name: values.name?.trim(),
      priority: Number(values.priority) || 0,
      colour_container_id: values.colour_container_id || null,
    })
    .eq("id", id);
  if (error) return { error: friendlyError(error) };
  revalidatePath("/admin/masterdata");
  return { error: null };
}

export async function deleteGrading(id: string): Promise<ActionResult> {
  await requireAnyMasterdataRole();
  const supabase = await createClient();
  const { error } = await supabase.from("grading").delete().eq("id", id);
  if (error) return { error: friendlyError(error) };
  revalidatePath("/admin/masterdata");
  return { error: null };
}

// ============================================================================
// Asset
// ============================================================================
export async function listAssets(): Promise<Asset[]> {
  await requireAnyMasterdataRole();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("asset")
    .select(
      "id, legacy_uid, name, code, purchase_date, active, has_service_plan, service_interval, asset_type_id, location_id, asset_type:asset_type_id(name), location:location_id(name)",
    )
    .order("name");
  if (error) throw error;
  return data as unknown as Asset[];
}

export async function createAsset(
  values: Record<string, string>,
): Promise<ActionResult> {
  await requireAnyMasterdataRole();
  const supabase = await createClient();
  const { error } = await supabase.from("asset").insert({
    name: values.name?.trim(),
    code: values.code?.trim(),
    purchase_date: values.purchase_date || null,
    active: values.active === "true",
    has_service_plan: values.has_service_plan === "true",
    service_interval: Number(values.service_interval) || 0,
    asset_type_id: values.asset_type_id || null,
    location_id: values.location_id || null,
  });
  if (error) return { error: friendlyError(error) };
  revalidatePath("/admin/masterdata");
  return { error: null };
}

export async function updateAsset(
  id: string,
  values: Record<string, string>,
): Promise<ActionResult> {
  await requireAnyMasterdataRole();
  const supabase = await createClient();
  const { error } = await supabase
    .from("asset")
    .update({
      name: values.name?.trim(),
      code: values.code?.trim(),
      purchase_date: values.purchase_date || null,
      active: values.active === "true",
      has_service_plan: values.has_service_plan === "true",
      service_interval: Number(values.service_interval) || 0,
      asset_type_id: values.asset_type_id || null,
      location_id: values.location_id || null,
    })
    .eq("id", id);
  if (error) return { error: friendlyError(error) };
  revalidatePath("/admin/masterdata");
  return { error: null };
}

export async function deleteAsset(id: string): Promise<ActionResult> {
  await requireAnyMasterdataRole();
  const supabase = await createClient();
  const { error } = await supabase.from("asset").delete().eq("id", id);
  if (error) return { error: friendlyError(error) };
  revalidatePath("/admin/masterdata");
  return { error: null };
}
