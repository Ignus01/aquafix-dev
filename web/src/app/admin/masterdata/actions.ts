"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/supabase/select-all";
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
  LoggerType,
  MeterType,
  TargetBand,
} from "@/lib/masterdata/types";
import { parseBands, sortBands, targetBandsError } from "../dashboard/water-format";

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
  return selectAll(() =>
    supabase
      .from("organisation")
      .select("id, legacy_uid, name, active, is_supplier, is_service_supplier")
      .order("name")
      .order("id"),
  );
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
  const data = await selectAll(() =>
    supabase
      .from("location")
      .select(
        "id, legacy_uid, name, active, transfer_type, is_stock_manager, is_asset_manager, volume_target, region_id, organisation_id, region:region_id(name), organisation:organisation_id(name), target_bands:location_target_band(from_pct, colour, label)",
      )
      .order("name")
      .order("id"),
  );
  return (data as unknown as Location[]).map((l) => ({
    ...l,
    target_bands: sortBands(l.target_bands ?? []),
  }));
}

// The Water section's target and bands, checked before anything is saved.
// Without a target the bands are ignored (the stored ones are kept).
function targetValues(
  values: Record<string, string>,
): { target: number | null; bands: TargetBand[] | null } | { error: string } {
  const raw = values.volume_target?.trim();
  if (!raw) return { target: null, bands: null };
  const target = Number(raw);
  if (!Number.isFinite(target) || target <= 0) {
    return { error: "The daily volume target must be more than 0 m³." };
  }
  const bands = parseBands(values.target_bands).map((b) => ({
    ...b,
    label: b.label?.trim() || null,
  }));
  const bandError = targetBandsError(bands);
  if (bandError) return { error: bandError };
  return { target: Math.round(target * 100) / 100, bands: sortBands(bands) };
}

// Target and bands change together or not at all (one database function).
async function saveTarget(
  supabase: Awaited<ReturnType<typeof createClient>>,
  locationId: string,
  target: { target: number | null; bands: TargetBand[] | null },
) {
  return supabase.rpc("save_location_target", {
    p_location_id: locationId,
    p_target: target.target,
    p_bands: target.bands,
  });
}

export async function createLocation(
  values: Record<string, string>,
): Promise<ActionResult> {
  await requireAnyMasterdataRole();
  const target = targetValues(values);
  if ("error" in target) return target;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("location")
    .insert({
      name: values.name?.trim(),
      active: values.active === "true",
      transfer_type: values.transfer_type || "AUTO",
      is_stock_manager: values.is_stock_manager === "true",
      is_asset_manager: values.is_asset_manager === "true",
      region_id: values.region_id || null,
      organisation_id: values.organisation_id || null,
    })
    .select("id")
    .single();
  if (error) return { error: friendlyError(error) };
  if (target.target !== null) {
    const { error: targetError } = await saveTarget(supabase, data.id, target);
    if (targetError) {
      revalidatePath("/admin/masterdata");
      return { error: `The location was saved, but not its target: ${friendlyError(targetError)}` };
    }
  }
  revalidatePath("/admin/masterdata");
  return { error: null };
}

export async function updateLocation(
  id: string,
  values: Record<string, string>,
): Promise<ActionResult> {
  await requireAnyMasterdataRole();
  const target = targetValues(values);
  if ("error" in target) return target;
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
  const { error: targetError } = await saveTarget(supabase, id, target);
  revalidatePath("/admin/masterdata");
  if (targetError) return { error: `The location was saved, but not its target: ${friendlyError(targetError)}` };
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
  const data = await selectAll(() =>
    supabase
      .from("asset")
      .select(
        "id, legacy_uid, name, code, logger_code, logger_type, meter_type, purchase_date, active, has_service_plan, service_interval, asset_type_id, location_id, asset_type:asset_type_id(name), location:location_id(name)",
      )
      .order("name")
      .order("id"),
  );
  return data as unknown as Asset[];
}

// A logger type is required with a logger code, and cleared without one.
function loggerColumns(
  values: Record<string, string>,
): { logger_code: string | null; logger_type: LoggerType | null } | { error: string } {
  const code = values.logger_code?.trim() || null;
  const type = (values.logger_type || null) as LoggerType | null;
  if (!code) return { logger_code: null, logger_type: null };
  if (!type) return { error: "Choose a logger type for the logger code." };
  return { logger_code: code, logger_type: type };
}

const METER_TYPES: MeterType[] = ["treated", "borehole", "other"];
const meterType = (values: Record<string, string>): MeterType | null =>
  METER_TYPES.find((t) => t === values.meter_type) ?? null;

export async function createAsset(
  values: Record<string, string>,
): Promise<ActionResult> {
  await requireAnyMasterdataRole();
  const logger = loggerColumns(values);
  if ("error" in logger) return logger;
  const supabase = await createClient();
  const { error } = await supabase.from("asset").insert({
    name: values.name?.trim(),
    code: values.code?.trim(),
    ...logger,
    meter_type: meterType(values),
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
  const logger = loggerColumns(values);
  if ("error" in logger) return logger;
  const supabase = await createClient();
  const { error } = await supabase
    .from("asset")
    .update({
      name: values.name?.trim(),
      code: values.code?.trim(),
      ...logger,
      meter_type: meterType(values),
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
