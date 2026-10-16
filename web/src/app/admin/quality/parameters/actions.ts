"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/supabase/select-all";
import { friendlyError } from "@/lib/db-errors";
import { QUALITY_READERS } from "@/lib/quality/permissions";
import type { Lab, LabLocationMap, LabParameterMap, QualityParameter } from "@/lib/quality/types";

// Quality → Parameters: parameters (with acceptable levels), the saved lab
// mappings and labs. Everyone reads; RLS lets only system admins and admins
// write, so a refused write comes back as the database's error.

type ActionResult = { error: string | null };

function revalidate() {
  revalidatePath("/admin/quality", "layout");
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function listParameters(): Promise<QualityParameter[]> {
  await requireRole(QUALITY_READERS);
  const supabase = await createClient();
  const rows = await selectAll(() =>
    supabase
      .from("quality_parameter")
      .select(
        "id, name, short_name, unit, min_acceptable, max_acceptable, can_be_negative, decimals, standard, sort_order, active",
      )
      .order("sort_order")
      .order("name")
      .order("id"),
  );
  return (rows as unknown as QualityParameter[]).map((p) => ({
    ...p,
    min_acceptable: num(p.min_acceptable),
    max_acceptable: num(p.max_acceptable),
  }));
}

export async function listLabs(): Promise<Lab[]> {
  await requireRole(QUALITY_READERS);
  const supabase = await createClient();
  const { data, error } = await supabase.from("lab").select("id, name, active").order("name");
  if (error) throw error;
  return data;
}

export async function listParameterMaps(): Promise<LabParameterMap[]> {
  await requireRole(QUALITY_READERS);
  const supabase = await createClient();
  const rows = await selectAll(() =>
    supabase
      .from("lab_parameter_map")
      .select("id, lab_id, lab_parameter, lab_unit, parameter_id, factor")
      .order("lab_parameter")
      .order("id"),
  );
  return (rows as unknown as LabParameterMap[]).map((m) => ({ ...m, factor: Number(m.factor) }));
}

export async function listLocationMaps(): Promise<LabLocationMap[]> {
  await requireRole(QUALITY_READERS);
  const supabase = await createClient();
  return (await selectAll(() =>
    supabase
      .from("lab_location_map")
      .select("id, lab_id, lab_locality, location_id")
      .order("lab_locality")
      .order("id"),
  )) as unknown as LabLocationMap[];
}

// ---- Parameters -------------------------------------------------------------

function optionalNumber(raw: string | undefined, label: string): number | null | { error: string } {
  const s = raw?.trim() ?? "";
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : { error: `${label} must be a number.` };
}

function parameterColumns(values: Record<string, string>) {
  const name = values.name?.trim();
  const unit = values.unit?.trim();
  if (!name) return { error: "Name is required." };
  if (!unit) return { error: "Unit is required." };
  const min = optionalNumber(values.min_acceptable, "Min");
  if (min !== null && typeof min === "object") return min;
  const max = optionalNumber(values.max_acceptable, "Max");
  if (max !== null && typeof max === "object") return max;
  if (min !== null && max !== null && min > max) return { error: "Min can't be more than Max." };
  const decimals = values.decimals?.trim() ? Number(values.decimals) : 2;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6) {
    return { error: "Decimals must be a whole number from 0 to 6." };
  }
  const order = values.sort_order?.trim() ? Number(values.sort_order) : 0;
  if (!Number.isInteger(order)) return { error: "Order must be a whole number." };
  return {
    name,
    short_name: values.short_name?.trim() || null,
    unit,
    min_acceptable: min,
    max_acceptable: max,
    can_be_negative: values.can_be_negative === "true",
    decimals,
    standard: values.standard?.trim() || null,
    sort_order: order,
    active: values.active !== "false",
  };
}

const PARAMETER_UNIQUE = "Must be unique — a parameter with that name already exists.";

export async function createParameter(
  values: Record<string, string>,
): Promise<ActionResult & { parameter?: QualityParameter }> {
  await requireRole(QUALITY_READERS);
  const columns = parameterColumns(values);
  if ("error" in columns) return { error: columns.error ?? null };
  const supabase = await createClient();
  // New parameters go to the end unless an order is given.
  if (!values.sort_order?.trim()) {
    const { data: top } = await supabase
      .from("quality_parameter")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    columns.sort_order = (top?.sort_order ?? 0) + 10;
  }
  const { data, error } = await supabase
    .from("quality_parameter")
    .insert(columns)
    .select(
      "id, name, short_name, unit, min_acceptable, max_acceptable, can_be_negative, decimals, standard, sort_order, active",
    )
    .single();
  if (error) return { error: error.code === "23505" ? PARAMETER_UNIQUE : friendlyError(error) };
  revalidate();
  return {
    error: null,
    parameter: { ...data, min_acceptable: num(data.min_acceptable), max_acceptable: num(data.max_acceptable) },
  };
}

export async function updateParameter(id: string, values: Record<string, string>): Promise<ActionResult> {
  await requireRole(QUALITY_READERS);
  const columns = parameterColumns(values);
  if ("error" in columns) return { error: columns.error ?? null };
  const supabase = await createClient();
  const { data, error } = await supabase.from("quality_parameter").update(columns).eq("id", id).select("id");
  if (error) return { error: error.code === "23505" ? PARAMETER_UNIQUE : friendlyError(error) };
  if (!data?.length) return { error: "You don't have permission to edit parameters." };
  revalidate();
  return { error: null };
}

export async function deleteParameter(id: string): Promise<ActionResult> {
  await requireRole(QUALITY_READERS);
  const supabase = await createClient();
  const { data, error } = await supabase.from("quality_parameter").delete().eq("id", id).select("id");
  if (error) return { error: friendlyError(error) };
  if (!data?.length) return { error: "You don't have permission to delete parameters." };
  revalidate();
  return { error: null };
}

// ---- Saved mappings (future imports only) -----------------------------------

export async function updateParameterMap(id: string, values: Record<string, string>): Promise<ActionResult> {
  await requireRole(QUALITY_READERS);
  const ignore = !values.parameter_id;
  const factor = values.factor?.trim() ? Number(values.factor) : 1;
  if (!ignore && (!Number.isFinite(factor) || factor <= 0)) return { error: "The factor must be more than 0." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lab_parameter_map")
    .update({
      lab_unit: values.lab_unit?.trim() || null,
      parameter_id: ignore ? null : values.parameter_id,
      factor: ignore ? 1 : factor,
    })
    .eq("id", id)
    .select("id");
  if (error) return { error: friendlyError(error) };
  if (!data?.length) return { error: "You don't have permission to edit mappings." };
  revalidate();
  return { error: null };
}

export async function deleteParameterMap(id: string): Promise<ActionResult> {
  await requireRole(QUALITY_READERS);
  const supabase = await createClient();
  const { data, error } = await supabase.from("lab_parameter_map").delete().eq("id", id).select("id");
  if (error) return { error: friendlyError(error) };
  if (!data?.length) return { error: "You don't have permission to delete mappings." };
  revalidate();
  return { error: null };
}

export async function updateLocationMap(id: string, values: Record<string, string>): Promise<ActionResult> {
  await requireRole(QUALITY_READERS);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lab_location_map")
    .update({ location_id: values.location_id || null })
    .eq("id", id)
    .select("id");
  if (error) return { error: friendlyError(error) };
  if (!data?.length) return { error: "You don't have permission to edit mappings." };
  revalidate();
  return { error: null };
}

export async function deleteLocationMap(id: string): Promise<ActionResult> {
  await requireRole(QUALITY_READERS);
  const supabase = await createClient();
  const { data, error } = await supabase.from("lab_location_map").delete().eq("id", id).select("id");
  if (error) return { error: friendlyError(error) };
  if (!data?.length) return { error: "You don't have permission to delete mappings." };
  revalidate();
  return { error: null };
}

// ---- Labs -------------------------------------------------------------------

const LAB_UNIQUE = "Must be unique — a lab with that name already exists.";

export async function createLab(values: Record<string, string>): Promise<ActionResult> {
  await requireRole(QUALITY_READERS);
  const supabase = await createClient();
  const { error } = await supabase
    .from("lab")
    .insert({ name: values.name?.trim(), active: values.active !== "false" });
  if (error) return { error: error.code === "23505" ? LAB_UNIQUE : friendlyError(error) };
  revalidate();
  return { error: null };
}

export async function updateLab(id: string, values: Record<string, string>): Promise<ActionResult> {
  await requireRole(QUALITY_READERS);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lab")
    .update({ name: values.name?.trim(), active: values.active === "true" })
    .eq("id", id)
    .select("id");
  if (error) return { error: error.code === "23505" ? LAB_UNIQUE : friendlyError(error) };
  if (!data?.length) return { error: "You don't have permission to edit labs." };
  revalidate();
  return { error: null };
}

export async function deleteLab(id: string): Promise<ActionResult> {
  await requireRole(QUALITY_READERS);
  const supabase = await createClient();
  const { data, error } = await supabase.from("lab").delete().eq("id", id).select("id");
  if (error) return { error: friendlyError(error) };
  if (!data?.length) return { error: "You don't have permission to delete labs." };
  revalidate();
  return { error: null };
}
