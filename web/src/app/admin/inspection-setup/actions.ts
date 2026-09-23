"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { friendlyError } from "@/lib/db-errors";
import type {
  Account,
  AssetTypeAllocation,
  GradingOption,
  IncidentSubscription,
  IncidentType,
  Inspection,
  InspectionDetail,
  InspectionRule,
  SaveInspectionPayload,
} from "@/lib/inspection-setup/types";

type ActionResult = { error: string | null };

// Same model as the masterdata actions: every call runs with the caller's own
// session, so the RLS policies (admin-only writes) are the real gate. This
// only confirms the caller is signed in with some role.
async function requireAnyRole() {
  await requireRole(["system_admin", "admin", "user", "viewer"]);
}

function revalidate() {
  revalidatePath("/admin/inspection-setup");
}

// ============================================================================
// Inspection
// ============================================================================
export async function listInspections(): Promise<Inspection[]> {
  await requireAnyRole();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inspection")
    .select(
      "id, legacy_uid, name, description, value_type, is_required, active, nr_of_images_required",
    )
    .order("name");
  if (error) throw error;
  return data;
}

export async function getInspectionDetail(
  id: string,
): Promise<InspectionDetail | null> {
  await requireAnyRole();
  const supabase = await createClient();

  const [inspection, options, rules, allocations] = await Promise.all([
    supabase
      .from("inspection")
      .select(
        "id, legacy_uid, name, description, value_type, is_required, active, nr_of_images_required",
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("inspection_drop_down_option")
      .select("id, name, grading_id, nr_of_images_required, priority, active")
      .eq("inspection_id", id)
      .order("priority"),
    // DS_Inspection_GetRules sorts the rules; ordered by range here.
    supabase
      .from("inspection_rule")
      .select(
        "id, lower_limit, upper_limit, nr_of_images_required, grading_id, is_first, feedback(feedback, max_nr_of_retries, auto_create_incident, incident_type_id)",
      )
      .eq("inspection_id", id)
      .order("lower_limit")
      .order("upper_limit"),
    supabase
      .from("inspection_allocation")
      .select("id, inspection_id, asset_type_id, priority")
      .eq("inspection_id", id)
      .order("priority"),
  ]);

  for (const res of [inspection, options, rules, allocations]) {
    if (res.error) throw res.error;
  }
  if (!inspection.data) return null;

  return {
    inspection: inspection.data,
    drop_down_options: options.data ?? [],
    // feedback is a one-to-one embed (unique FK), so PostgREST returns an
    // object or null — normalise in case it comes back as an array.
    rules: (rules.data ?? []).map((r) => {
      const fb = r.feedback as unknown;
      return {
        ...r,
        lower_limit: Number(r.lower_limit),
        upper_limit: Number(r.upper_limit),
        feedback: (Array.isArray(fb) ? (fb[0] ?? null) : fb) as InspectionRule["feedback"],
      };
    }),
    allocations: allocations.data ?? [],
  };
}

// ACT_Inspection_Save: validates, then commits the Inspection together with
// its option/rule/allocation lists in one transaction (save_inspection()).
export async function saveInspection(
  payload: SaveInspectionPayload,
): Promise<{ error: string | null; id?: string }> {
  await requireAnyRole();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_inspection", {
    p_inspection: payload,
  });
  if (error) return { error: friendlyError(error) };
  revalidate();
  revalidatePath("/admin/masterdata");
  return { error: null, id: data as string };
}

// Cascades to the inspection's rules (and their feedback), drop-down options
// and asset type allocations.
export async function deleteInspection(id: string): Promise<ActionResult> {
  await requireAnyRole();
  const supabase = await createClient();
  const { error } = await supabase.from("inspection").delete().eq("id", id);
  if (error) return { error: friendlyError(error) };
  revalidate();
  revalidatePath("/admin/masterdata");
  return { error: null };
}

// Grading picker for drop-down options and rules — sorted by priority, with
// the colour badge (Masterdata.SNIP_Grading in the source app).
export async function listGradingOptions(): Promise<GradingOption[]> {
  await requireAnyRole();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("grading")
    .select("id, name, priority, colour_container:colour_container_id(hex_colour)")
    .order("priority");
  if (error) throw error;
  return data.map((g) => {
    const cc = g.colour_container as unknown as { hex_colour: string | null } | null;
    return { id: g.id, name: g.name, priority: g.priority, hex_colour: cc?.hex_colour ?? null };
  });
}

export async function listAssetTypeOptions(): Promise<
  { id: string; name: string; active: boolean }[]
> {
  await requireAnyRole();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("asset_type")
    .select("id, name, active")
    .order("name");
  if (error) throw error;
  return data;
}

// ============================================================================
// IncidentType
// ============================================================================
export async function listIncidentTypes(): Promise<IncidentType[]> {
  await requireAnyRole();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("incident_type")
    .select("id, legacy_uid, name, is_image_required, disables_location, active")
    .order("name");
  if (error) throw error;
  return data;
}

function incidentTypeValues(values: Record<string, string>) {
  return {
    name: values.name?.trim() ?? "",
    is_image_required: values.is_image_required === "true",
    disables_location: values.disables_location === "true",
    active: values.active === "true",
  };
}

export async function createIncidentType(
  values: Record<string, string>,
): Promise<{ error: string | null; id?: string }> {
  await requireAnyRole();
  const row = incidentTypeValues(values);
  // INC-R01
  if (!row.name) return { error: "Name is required." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("incident_type")
    .insert(row)
    .select("id")
    .single();
  if (error) return { error: friendlyError(error) };
  revalidate();
  return { error: null, id: data.id };
}

export async function updateIncidentType(
  id: string,
  values: Record<string, string>,
): Promise<ActionResult> {
  await requireAnyRole();
  const row = incidentTypeValues(values);
  if (!row.name) return { error: "Name is required." };
  const supabase = await createClient();
  const { error } = await supabase.from("incident_type").update(row).eq("id", id);
  if (error) return { error: friendlyError(error) };
  revalidate();
  return { error: null };
}

// Cascades to the type's subscriptions; blocked while a rule's feedback uses it.
export async function deleteIncidentType(id: string): Promise<ActionResult> {
  await requireAnyRole();
  const supabase = await createClient();
  const { error } = await supabase.from("incident_type").delete().eq("id", id);
  if (error) return { error: friendlyError(error) };
  revalidate();
  return { error: null };
}

// ============================================================================
// IncidentSubscription
// ============================================================================
export async function listIncidentSubscriptions(
  incidentTypeId: string,
): Promise<IncidentSubscription[]> {
  await requireAnyRole();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("incident_subscription")
    .select("id, incident_type_id, user_id, updated_at")
    .eq("incident_type_id", incidentTypeId);
  if (error) throw error;
  return data;
}

// Accounts with an email address, sorted by name (the Account picker's
// `[Email != empty]` filter in the source app).
export async function listAccounts(): Promise<Account[]> {
  await requireAnyRole();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_subscribable_accounts");
  if (error) throw error;
  return (data ?? []) as Account[];
}

export async function createIncidentSubscription(
  incidentTypeId: string,
  userId: string,
): Promise<ActionResult> {
  await requireAnyRole();
  // INCSUB-R01 (INCSUB-R02 is the unique constraint → "Already added").
  if (!userId) return { error: "Account is required." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("incident_subscription")
    .insert({ incident_type_id: incidentTypeId, user_id: userId });
  if (error) return { error: friendlyError(error) };
  revalidate();
  return { error: null };
}

export async function deleteIncidentSubscription(id: string): Promise<ActionResult> {
  await requireAnyRole();
  const supabase = await createClient();
  const { error } = await supabase.from("incident_subscription").delete().eq("id", id);
  if (error) return { error: friendlyError(error) };
  revalidate();
  return { error: null };
}

// ============================================================================
// InspectionAllocation — AssetType side (Masterdata.AssetType_NewEdit's grid)
// ============================================================================
export async function listAssetTypeAllocations(
  assetTypeId: string,
): Promise<AssetTypeAllocation[]> {
  await requireAnyRole();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inspection_allocation")
    .select("id, inspection_id, priority, inspection:inspection_id(name, active)")
    .eq("asset_type_id", assetTypeId)
    .order("priority");
  if (error) throw error;
  return data as unknown as AssetTypeAllocation[];
}

export async function createAssetTypeAllocation(
  assetTypeId: string,
  inspectionId: string,
): Promise<ActionResult> {
  await requireAnyRole();
  // IAA-R03 (IAA-R04 is the unique constraint → "Already added").
  if (!inspectionId) return { error: "Inspection is required." };
  const supabase = await createClient();
  // priority is assigned by the insert trigger (end of this AssetType's list).
  const { error } = await supabase
    .from("inspection_allocation")
    .insert({ asset_type_id: assetTypeId, inspection_id: inspectionId });
  if (error) return { error: friendlyError(error) };
  revalidate();
  return { error: null };
}

export async function deleteAllocation(id: string): Promise<ActionResult> {
  await requireAnyRole();
  const supabase = await createClient();
  const { error } = await supabase.from("inspection_allocation").delete().eq("id", id);
  if (error) return { error: friendlyError(error) };
  revalidate();
  return { error: null };
}

// ACT_InspectionAllocation_UpdateSortOrder: rewrite priorities 1..n.
export async function reorderAssetTypeAllocations(
  assetTypeId: string,
  orderedIds: string[],
): Promise<ActionResult> {
  await requireAnyRole();
  const supabase = await createClient();
  const { error } = await supabase.rpc("reorder_inspection_allocations", {
    p_asset_type_id: assetTypeId,
    p_ordered_ids: orderedIds,
  });
  if (error) return { error: friendlyError(error) };
  revalidate();
  return { error: null };
}
