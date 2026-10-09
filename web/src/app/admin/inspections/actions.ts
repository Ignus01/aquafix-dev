"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/supabase/select-all";
import { getCurrentUser, requireRole } from "@/lib/auth";
import { friendlyError } from "@/lib/db-errors";
import type { IncidentImage } from "@/lib/incidents/types";
import { startOfTodayIso, todayInZone } from "@/lib/inspections/dates";
import {
  INSPECTION_ADMINS,
  INSPECTION_BACK_OFFICE,
  INSPECTION_READERS,
  INSPECTION_WRITERS,
} from "@/lib/inspections/permissions";
import type {
  AccountOption,
  ActivityDetail,
  ActivityListRow,
  AssetOption,
  CaptureContext,
  CaptureInspection,
  CaptureValue,
  CumulativeRow,
  GradingBadgeData,
  InstructionAllocation,
  InstructionDetail,
  InstructionListRow,
  PublicHoliday,
  SaveActivityPayload,
  SaveActivityResult,
  SaveInstructionPayload,
  SaveScheduledInstructionPayload,
  ScheduleRun,
  ScheduledInstructionRow,
  ValueListRow,
} from "@/lib/inspections/types";

// Same model as the other sections: every call runs with the caller's own
// session, so RLS and the RPCs' role checks are the real gate.

const BUCKET = "inspection-images";
const SIGNED_URL_TTL = 60 * 60;
const MAX_ROWS = 1000;

type ActionResult = { error: string | null };

const ASSET_COLUMNS =
  "id, name, code, active, asset_type:asset_type_id(id, name), location:location_id(id, name)";
const GRADING_COLUMNS = "id, name, colour_container:colour_container_id(hex_colour)";

function revalidate() {
  revalidatePath("/admin/inspections", "layout");
}

type RawGrading = { id: string; name: string; colour_container: { hex_colour: string | null } | null } | null;

function toGrading(g: RawGrading): GradingBadgeData | null {
  return g ? { id: g.id, name: g.name, hex_colour: g.colour_container?.hex_colour ?? null } : null;
}

async function userNames(supabase: SupabaseClient, ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const names = new Map<string, string>();
  if (unique.length === 0) return names;
  const { data, error } = await supabase.rpc("get_user_names", { p_ids: unique });
  if (error) throw error;
  for (const row of (data ?? []) as { id: string; name: string }[]) names.set(row.id, row.name);
  return names;
}

export async function getAppTimeZone(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("app_time_zone");
  return (data as string | null) ?? "Africa/Johannesburg";
}

async function signImages(
  supabase: SupabaseClient,
  images: { id: string; storage_path: string; thumbnail_path: string | null; mime_type: string; created_by: string | null; created_at: string }[],
): Promise<IncidentImage[]> {
  const paths = images.flatMap((i) => [i.storage_path, i.thumbnail_path ?? i.storage_path]);
  const urls = new Map<string, string>();
  if (paths.length > 0) {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrls([...new Set(paths)], SIGNED_URL_TTL);
    for (const entry of data ?? []) {
      if (entry.path && entry.signedUrl) urls.set(entry.path, entry.signedUrl);
    }
  }
  return images.map((i) => ({
    id: i.id,
    mime_type: i.mime_type,
    created_by: i.created_by,
    created_at: i.created_at,
    url: urls.get(i.storage_path) ?? null,
    thumb_url: urls.get(i.thumbnail_path ?? i.storage_path) ?? urls.get(i.storage_path) ?? null,
  }));
}

async function removeFiles(supabase: SupabaseClient, paths: string[]) {
  if (paths.length === 0) return;
  // Best effort: nothing references these any more.
  await supabase.storage.from(BUCKET).remove(paths);
}

// ============================================================================
// Pickers
// ============================================================================

// Every asset, inactive ones included (SCH-R08 / INS-R04 pickers).
export async function listAssetOptions(): Promise<AssetOption[]> {
  await requireRole(INSPECTION_READERS);
  const supabase = await createClient();
  const data = await selectAll(() => supabase.from("asset").select(ASSET_COLUMNS).order("name").order("id"));
  return data as unknown as AssetOption[];
}

// Instruction_NewEdit's Account picker (accounts with a name, sorted).
export async function listAccounts(): Promise<AccountOption[]> {
  await requireRole(INSPECTION_READERS);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_subscribable_accounts");
  if (error) throw error;
  return (data ?? []) as AccountOption[];
}

// Inspection_SelectLocation: [Active][IsAssetManager] locations by name.
export async function listInspectionLocations(): Promise<{ id: string; name: string; asset_count: number }[]> {
  await requireRole(INSPECTION_WRITERS);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("location")
    .select("id, name, assets:asset(count)")
    .eq("active", true)
    .eq("is_asset_manager", true)
    .eq("assets.active", true)
    .order("name");
  if (error) throw error;
  return (data as unknown as { id: string; name: string; assets: { count: number }[] }[]).map((l) => ({
    id: l.id,
    name: l.name,
    asset_count: l.assets[0]?.count ?? 0,
  }));
}

// Inspection_SelectAsset: [Active] assets at a location, by type then name.
export async function listLocationAssets(locationId: string): Promise<{
  location: { id: string; name: string } | null;
  assets: (AssetOption & { last_inspection_date: string | null })[];
}> {
  await requireRole(INSPECTION_WRITERS);
  const supabase = await createClient();
  const [location, assets] = await Promise.all([
    supabase.from("location").select("id, name").eq("id", locationId).maybeSingle(),
    supabase
      .from("asset")
      .select(`${ASSET_COLUMNS}, last_inspection_date`)
      .eq("location_id", locationId)
      .eq("active", true),
  ]);
  if (location.error) throw location.error;
  if (assets.error) throw assets.error;
  const rows = (assets.data as unknown as (AssetOption & { last_inspection_date: string | null })[]).sort(
    (a, b) => a.asset_type.name.localeCompare(b.asset_type.name) || a.name.localeCompare(b.name),
  );
  return { location: location.data, assets: rows };
}

// ============================================================================
// Instructions
// ============================================================================
const INSTRUCTION_COLUMNS =
  "id, legacy_uid, name, comment, status, nr_of_allocations, nr_completed, is_scheduled, " +
  "required_completed_date, account_id, updated_at";

type RawInstruction = Omit<InstructionListRow, "account_name">;

async function withAccountNames(supabase: SupabaseClient, rows: RawInstruction[]): Promise<InstructionListRow[]> {
  const names = await userNames(supabase, rows.map((r) => r.account_id));
  return rows.map((r) => ({ ...r, account_name: r.account_id ? (names.get(r.account_id) ?? null) : null }));
}

// Inspection_Overview → Instructions → Instructions (newest first).
export async function listInstructions(): Promise<InstructionListRow[]> {
  await requireRole(INSPECTION_BACK_OFFICE);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("instruction")
    .select(INSTRUCTION_COLUMNS)
    .order("legacy_uid", { ascending: false })
    .limit(MAX_ROWS);
  if (error) throw error;
  return withAccountNames(supabase, data as unknown as RawInstruction[]);
}

// INS-R07 Instruction_Overview: my open instructions, by due date.
export async function listMyOpenInstructions(): Promise<InstructionListRow[]> {
  await requireRole(INSPECTION_WRITERS);
  const user = await getCurrentUser();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("instruction")
    .select(INSTRUCTION_COLUMNS)
    .eq("account_id", user!.id)
    .neq("status", "completed")
    .order("required_completed_date")
    .order("legacy_uid");
  if (error) throw error;
  return withAccountNames(supabase, data as unknown as RawInstruction[]);
}

// Instruction_ViewProgress (admins) and Instruction_SelectAsset (field).
export async function getInstructionDetail(uid: number): Promise<InstructionDetail | null> {
  await requireRole(INSPECTION_READERS);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("instruction")
    .select(INSTRUCTION_COLUMNS)
    .eq("legacy_uid", uid)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const instruction = data as unknown as RawInstruction;

  const [allocations, activities] = await Promise.all([
    supabase
      .from("instruction_asset_allocation")
      .select(`id, is_completed, asset:asset_id(${ASSET_COLUMNS})`)
      .eq("instruction_id", instruction.id),
    supabase
      .from("inspection_activity")
      .select(`id, legacy_uid, asset_id, created_by, inspection_date, grading:grading_id(${GRADING_COLUMNS})`)
      .eq("instruction_id", instruction.id)
      .order("inspection_date"),
  ]);
  if (allocations.error) throw allocations.error;
  if (activities.error) throw activities.error;

  const rawActivities = activities.data as unknown as {
    id: string;
    legacy_uid: number;
    asset_id: string;
    created_by: string | null;
    grading: RawGrading;
  }[];
  const names = await userNames(supabase, [instruction.account_id, ...rawActivities.map((a) => a.created_by)]);
  // DS_InstructionAssetAllocation_GetInspectionActivity: the first activity.
  const firstByAsset = new Map<string, (typeof rawActivities)[number]>();
  for (const a of rawActivities) if (!firstByAsset.has(a.asset_id)) firstByAsset.set(a.asset_id, a);

  const rows = (allocations.data as unknown as { id: string; is_completed: boolean; asset: AssetOption }[])
    .map((a): InstructionAllocation => {
      const act = firstByAsset.get(a.asset.id);
      return {
        id: a.id,
        is_completed: a.is_completed,
        asset: a.asset,
        activity: act
          ? {
              id: act.id,
              legacy_uid: act.legacy_uid,
              inspected_by_name: act.created_by ? (names.get(act.created_by) ?? null) : null,
              grading: toGrading(act.grading),
            }
          : null,
      };
    })
    // Instruction_SelectAsset: by type, location, then name.
    .sort(
      (a, b) =>
        a.asset.asset_type.name.localeCompare(b.asset.asset_type.name) ||
        a.asset.location.name.localeCompare(b.asset.location.name) ||
        a.asset.name.localeCompare(b.asset.name),
    );

  return {
    ...instruction,
    account_name: instruction.account_id ? (names.get(instruction.account_id) ?? null) : null,
    allocations: rows,
  };
}

// ACT_Instruction_Save (INS-R02 field checks; save_instruction repeats them).
export async function saveInstruction(
  payload: SaveInstructionPayload,
): Promise<{ error: string | null; fieldErrors?: Record<string, string>; uid?: number }> {
  await requireRole(INSPECTION_ADMINS);
  const timeZone = await getAppTimeZone();
  const fieldErrors: Record<string, string> = {};
  if (!payload.name.trim()) fieldErrors.name = "Required";
  if (!payload.account_id) fieldErrors.account_id = "Required";
  if (!payload.required_completed_date) fieldErrors.required_completed_date = "Required";
  else if (payload.required_completed_date < todayInZone(timeZone)) {
    fieldErrors.required_completed_date = "Must be today or in the future.";
  }
  if (Object.keys(fieldErrors).length > 0) return { error: null, fieldErrors };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_instruction", { p_instruction: payload });
  if (error) return { error: friendlyError(error) };
  const { data: row } = await supabase.from("instruction").select("legacy_uid").eq("id", data as string).single();
  revalidate();
  return { error: null, uid: row?.legacy_uid };
}

// Blocked while activities exist (FK); allocations cascade.
export async function deleteInstruction(id: string): Promise<ActionResult> {
  await requireRole(INSPECTION_ADMINS);
  const supabase = await createClient();
  const { data, error } = await supabase.from("instruction").delete().eq("id", id).select("id");
  if (error) return { error: friendlyError(error) };
  if (!data || data.length === 0) return { error: "You don't have permission to delete this instruction." };
  revalidate();
  return { error: null };
}

// INS-R06.
export async function deleteInstructionAllocation(
  id: string,
): Promise<{ error: string | null; instructionDeleted?: boolean }> {
  await requireRole(INSPECTION_ADMINS);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_instruction_allocation", { p_allocation_id: id });
  if (error) return { error: friendlyError(error) };
  revalidate();
  return { error: null, instructionDeleted: (data as { instruction_deleted: boolean }).instruction_deleted };
}

// ============================================================================
// Scheduled instructions
// ============================================================================
export async function listScheduledInstructions(): Promise<ScheduledInstructionRow[]> {
  await requireRole(INSPECTION_BACK_OFFICE);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("scheduled_instruction")
    .select(
      "id, legacy_uid, name, comment, schedule_type, include_weekends, include_public_holidays, " +
        "day_of_month, week_days, days_to_complete, active, account_id, assets:scheduled_instruction_asset(asset_id)",
    )
    .order("legacy_uid");
  if (error) throw error;
  const rows = data as unknown as (Omit<ScheduledInstructionRow, "account_name" | "asset_ids"> & {
    assets: { asset_id: string }[];
  })[];
  const names = await userNames(supabase, rows.map((r) => r.account_id));
  return rows.map(({ assets, ...r }) => ({
    ...r,
    account_name: r.account_id ? (names.get(r.account_id) ?? null) : null,
    asset_ids: assets.map((a) => a.asset_id),
  }));
}

// ScheduledInstruction_Validate field checks (save_scheduled_instruction
// repeats them). SCH-R03 is a popup in Mendix, so it's a form-level error.
export async function saveScheduledInstruction(
  payload: SaveScheduledInstructionPayload,
): Promise<{ error: string | null; fieldErrors?: Record<string, string> }> {
  await requireRole(INSPECTION_ADMINS);
  const fieldErrors: Record<string, string> = {};
  if (!payload.name.trim()) fieldErrors.name = "Required";
  if (!payload.account_id) fieldErrors.account_id = "Required";
  if (!payload.schedule_type) fieldErrors.schedule_type = "Required";
  else if (payload.schedule_type === "monthly") {
    if (payload.day_of_month === null) fieldErrors.day_of_month = "Required";
    else if (payload.day_of_month < 1 || payload.day_of_month > 30) {
      fieldErrors.day_of_month = "Must be between 1 and 30.";
    }
  } else if (payload.schedule_type === "weekly" && payload.week_days.length === 0) {
    fieldErrors.week_days = "Required";
  }
  if (payload.days_to_complete < 0) fieldErrors.days_to_complete = "Must be 0 or more.";
  const assetsError = payload.asset_ids.length === 0 ? "Please assign Assets." : null;
  if (Object.keys(fieldErrors).length > 0 || assetsError) return { error: assetsError, fieldErrors };

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_scheduled_instruction", { p_schedule: payload });
  if (error) return { error: friendlyError(error) };
  revalidate();
  return { error: null };
}

// Issued instructions are kept (their schedule link is cleared).
export async function deleteScheduledInstruction(id: string): Promise<ActionResult> {
  await requireRole(INSPECTION_ADMINS);
  const supabase = await createClient();
  const { data, error } = await supabase.from("scheduled_instruction").delete().eq("id", id).select("id");
  if (error) return { error: friendlyError(error) };
  if (!data || data.length === 0) return { error: "You don't have permission to delete this schedule." };
  revalidate();
  return { error: null };
}

// SCH-R10: the "Run Schedule" button.
export async function runSchedule(): Promise<{
  error: string | null;
  issued?: number;
  problems?: { name: string; reason: string }[];
}> {
  await requireRole(INSPECTION_ADMINS);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("run_instruction_schedule");
  if (error) return { error: friendlyError(error) };
  revalidate();
  const result = data as { issued: number; problems: { name: string; reason: string }[] };
  return { error: null, issued: result.issued, problems: result.problems };
}

export async function listScheduleRuns(): Promise<ScheduleRun[]> {
  await requireRole(INSPECTION_ADMINS);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("instruction_schedule_run")
    .select("id, run_date, trigger, status, started_at, issued_count, problems")
    .order("started_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  return data as ScheduleRun[];
}

export async function listPublicHolidays(): Promise<PublicHoliday[]> {
  await requireRole(INSPECTION_READERS);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("public_holiday")
    .select("id, holiday_date, name")
    .order("holiday_date", { ascending: false });
  if (error) throw error;
  return data;
}

export async function createPublicHoliday(holidayDate: string, name: string): Promise<ActionResult> {
  await requireRole(INSPECTION_ADMINS);
  if (!holidayDate) return { error: "Date is required." };
  if (!name.trim()) return { error: "Name is required." };
  const supabase = await createClient();
  const { error } = await supabase.from("public_holiday").insert({ holiday_date: holidayDate, name: name.trim() });
  if (error) return { error: friendlyError(error) };
  revalidate();
  return { error: null };
}

export async function deletePublicHoliday(id: string): Promise<ActionResult> {
  await requireRole(INSPECTION_ADMINS);
  const supabase = await createClient();
  const { error } = await supabase.from("public_holiday").delete().eq("id", id);
  if (error) return { error: friendlyError(error) };
  revalidate();
  return { error: null };
}

// ============================================================================
// Activities and values
// ============================================================================
const ACTIVITY_COLUMNS =
  `id, legacy_uid, inspection_date, created_by, asset:asset_id(${ASSET_COLUMNS}), ` +
  `instruction:instruction_id(id, legacy_uid, name), grading:grading_id(${GRADING_COLUMNS})`;

type RawActivity = Omit<ActivityListRow, "inspected_by_name" | "grading"> & { grading: RawGrading };

async function toActivityRows(supabase: SupabaseClient, rows: RawActivity[]): Promise<ActivityListRow[]> {
  const names = await userNames(supabase, rows.map((r) => r.created_by));
  return rows.map((r) => ({
    ...r,
    grading: toGrading(r.grading),
    inspected_by_name: r.created_by ? (names.get(r.created_by) ?? null) : null,
  }));
}

// Inspection_Overview_PWA: my activities from today.
export async function listMyActivitiesToday(): Promise<ActivityListRow[]> {
  await requireRole(INSPECTION_WRITERS);
  const [user, timeZone] = await Promise.all([getCurrentUser(), getAppTimeZone()]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inspection_activity")
    .select(ACTIVITY_COLUMNS)
    .eq("created_by", user!.id)
    .gte("inspection_date", startOfTodayIso(timeZone))
    .order("inspection_date", { ascending: false });
  if (error) throw error;
  return toActivityRows(supabase, data as unknown as RawActivity[]);
}

// Inspection_Overview → Inspection Activities (newest first).
export async function listActivities(): Promise<ActivityListRow[]> {
  await requireRole(INSPECTION_BACK_OFFICE);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inspection_activity")
    .select(ACTIVITY_COLUMNS)
    .order("inspection_date", { ascending: false })
    .limit(MAX_ROWS);
  if (error) throw error;
  return toActivityRows(supabase, data as unknown as RawActivity[]);
}

// Inspection_Overview → Inspection Values (superseded attempts included).
export async function listValues(): Promise<ValueListRow[]> {
  await requireRole(INSPECTION_BACK_OFFICE);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inspection_value")
    .select(
      `id, display_value, is_current, sort_order, images:inspection_image(count), inspection:inspection_id(id, name), ` +
        `grading:grading_id(${GRADING_COLUMNS}), ` +
        `activity:inspection_activity_id(id, legacy_uid, inspection_date, asset:asset_id(${ASSET_COLUMNS}))`,
    )
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);
  if (error) throw error;
  type Raw = Omit<ValueListRow, "image_count" | "grading"> & {
    sort_order: number;
    images: { count: number }[];
    grading: RawGrading;
  };
  // Newest activity first; each activity's values in page order.
  return (data as unknown as Raw[])
    .sort(
      (a, b) =>
        b.activity.inspection_date.localeCompare(a.activity.inspection_date) ||
        b.activity.legacy_uid - a.activity.legacy_uid ||
        a.sort_order - b.sort_order,
    )
    .map(({ images, grading, sort_order: _sortOrder, ...v }) => {
      void _sortOrder;
      return { ...v, grading: toGrading(grading), image_count: images[0]?.count ?? 0 };
    });
}

// InspectionActivity_ViewInspectionValue, with each value's photos.
export async function getActivityDetail(uid: number): Promise<ActivityDetail | null> {
  await requireRole(INSPECTION_READERS);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inspection_activity")
    .select(ACTIVITY_COLUMNS)
    .eq("legacy_uid", uid)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const [activity] = await toActivityRows(supabase, [data as unknown as RawActivity]);

  const { data: values, error: valuesError } = await supabase
    .from("inspection_value")
    .select(
      `id, display_value, is_current, inspection:inspection_id(id, name, value_type), ` +
        `grading:grading_id(${GRADING_COLUMNS}), ` +
        `images:inspection_image(id, storage_path, thumbnail_path, mime_type, created_by, created_at)`,
    )
    .eq("inspection_activity_id", activity.id)
    .order("sort_order");
  if (valuesError) throw valuesError;

  type Raw = Omit<ActivityDetail["values"][number], "grading" | "images"> & {
    grading: RawGrading;
    images: Parameters<typeof signImages>[1];
  };
  const rawValues = values as unknown as Raw[];
  const signed = await Promise.all(
    rawValues.map((v) => signImages(supabase, [...v.images].sort((a, b) => a.created_at.localeCompare(b.created_at)))),
  );
  return {
    ...activity,
    values: rawValues.map((v, i) => ({ ...v, grading: toGrading(v.grading), images: signed[i] })),
  };
}

// INS-R09 Instruction_ViewInspectionActivity: every activity of the
// instruction with its values and photos, oldest first.
export async function getInstructionReport(
  uid: number,
): Promise<{ instruction: InstructionDetail; activities: ActivityDetail[] } | null> {
  await requireRole(INSPECTION_BACK_OFFICE);
  const instruction = await getInstructionDetail(uid);
  if (!instruction) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inspection_activity")
    .select("legacy_uid")
    .eq("instruction_id", instruction.id)
    .order("inspection_date");
  if (error) throw error;
  const activities = await Promise.all(data.map((a) => getActivityDetail(a.legacy_uid as number)));
  return { instruction, activities: activities.filter((a): a is ActivityDetail => a !== null) };
}

// Admins only (RLS); recomputes the instruction tick and asset date
// (IAC-R05 fix), then removes the photo files.
export async function deleteActivity(id: string): Promise<ActionResult> {
  await requireRole(INSPECTION_ADMINS);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_inspection_activity", { p_activity_id: id });
  if (error) return { error: friendlyError(error) };
  await removeFiles(supabase, (data as { removed_paths: string[] }).removed_paths ?? []);
  revalidate();
  return { error: null };
}

// ACT_InspectionImage_Download (admins). Keeps the real extension and a safe
// location slug (fixes the always-".png" name).
export async function getInspectionImageDownloadUrl(
  imageId: string,
): Promise<{ error: string | null; url?: string }> {
  await requireRole(INSPECTION_ADMINS);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inspection_image")
    .select(
      "storage_path, mime_type, value:inspection_value_id(legacy_uid, activity:inspection_activity_id(asset:asset_id(location:location_id(name))))",
    )
    .eq("id", imageId)
    .maybeSingle();
  if (error || !data) return { error: "That image no longer exists." };
  const row = data as unknown as {
    storage_path: string;
    mime_type: string;
    value: { legacy_uid: number; activity: { asset: { location: { name: string } } } } | null;
  };
  const location = (row.value?.activity.asset.location.name ?? "location")
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  const ext = row.mime_type.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
  const name = `${row.value?.legacy_uid ?? "inspection"}_${location || "location"}.${ext}`;
  const { data: signed, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(row.storage_path, 60, { download: name });
  if (signError || !signed) return { error: "Could not prepare the download." };
  return { error: null, url: signed.signedUrl };
}

// ============================================================================
// Cumulative values
// ============================================================================
export async function listCumulativeValues(): Promise<CumulativeRow[]> {
  await requireRole(INSPECTION_BACK_OFFICE);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inspection_cumulative_value")
    .select(`id, legacy_uid, latest_value, updated_at, inspection:inspection_id(id, name), asset:asset_id(${ASSET_COLUMNS})`)
    .order("updated_at", { ascending: false })
    .limit(MAX_ROWS);
  if (error) throw error;
  return data as unknown as CumulativeRow[];
}

// InspectionCumulativeValue_Edit (admins). Audited by trigger.
export async function updateCumulativeValue(id: string, value: number): Promise<ActionResult> {
  await requireRole(INSPECTION_ADMINS);
  if (!Number.isFinite(value)) return { error: "Enter a number." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("inspection_cumulative_value")
    .update({ latest_value: value })
    .eq("id", id)
    .select("id");
  if (error) return { error: friendlyError(error) };
  if (!data || data.length === 0) return { error: "You don't have permission to change this value." };
  revalidate();
  return { error: null };
}

// ============================================================================
// Capture (Inspection_NewEdit)
// ============================================================================
async function loadInspections(supabase: SupabaseClient, ids: string[]): Promise<Map<string, CaptureInspection>> {
  const map = new Map<string, CaptureInspection>();
  if (ids.length === 0) return map;
  const { data, error } = await supabase
    .from("inspection")
    .select(
      `id, name, description, value_type, is_required, nr_of_images_required, ` +
        `options:inspection_drop_down_option(id, name, active, priority, grading:grading_id(${GRADING_COLUMNS}))`,
    )
    .in("id", ids);
  if (error) throw error;
  type Raw = Omit<CaptureInspection, "options"> & {
    options: (Omit<CaptureInspection["options"][number], "grading"> & { grading: RawGrading })[];
  };
  for (const i of data as unknown as Raw[]) {
    map.set(i.id, {
      ...i,
      options: i.options
        .map((o) => ({ ...o, grading: toGrading(o.grading) }))
        .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name)),
    });
  }
  return map;
}

// ACT_InspectionActivity_New (IAC-R01): one value per Inspection allocated to
// the asset's type, in allocation priority order. Nothing is saved yet.
export async function getNewCaptureContext(
  assetId: string,
  instructionId: string | null,
): Promise<{ error: string } | CaptureContext> {
  await requireRole(INSPECTION_WRITERS);
  const supabase = await createClient();

  const { data: asset, error } = await supabase
    .from("asset")
    .select(`${ASSET_COLUMNS}, asset_type_id`)
    .eq("id", assetId)
    .maybeSingle();
  if (error) throw error;
  if (!asset) return { error: "That asset no longer exists." };
  const a = asset as unknown as AssetOption & { asset_type_id: string };

  let instruction: CaptureContext["instruction"] = null;
  if (instructionId) {
    const { data: alloc } = await supabase
      .from("instruction_asset_allocation")
      .select("is_completed, instruction:instruction_id(id, legacy_uid, name)")
      .eq("instruction_id", instructionId)
      .eq("asset_id", assetId)
      .maybeSingle();
    const row = alloc as unknown as { is_completed: boolean; instruction: CaptureContext["instruction"] } | null;
    if (!row) return { error: "This asset is not on that instruction." };
    // INS-R07: tapping a completed allocation does nothing.
    if (row.is_completed) return { error: `${a.name} has already been Inspected.` };
    instruction = row.instruction;
  }

  // [AS-IS] Inactive inspections that are still allocated are asked too.
  const { data: allocations, error: allocError } = await supabase
    .from("inspection_allocation")
    .select("inspection_id, priority")
    .eq("asset_type_id", a.asset_type_id)
    .order("priority");
  if (allocError) throw allocError;
  const ids = allocations.map((x) => x.inspection_id as string);
  const inspections = await loadInspections(supabase, ids);

  const values: CaptureValue[] = ids
    .filter((id) => inspections.has(id))
    .map((id) => ({
      id: crypto.randomUUID(),
      inspection_id: id,
      is_current: true,
      text_value: "",
      decimal_value: "0",
      date_value: "",
      drop_down_option_id: "",
      images: [],
    }));

  const { asset_type_id: _assetTypeId, ...assetOption } = a;
  void _assetTypeId;
  return { activity: null, asset: assetOption, instruction, inspections: [...inspections.values()], values };
}

// IAC-R06: reopen a saved activity (the inspector's own, from today).
export async function getEditCaptureContext(uid: number): Promise<{ error: string } | CaptureContext> {
  await requireRole(INSPECTION_WRITERS);
  const [user, timeZone] = await Promise.all([getCurrentUser(), getAppTimeZone()]);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("inspection_activity")
    .select(
      `id, legacy_uid, inspection_date, created_by, asset:asset_id(${ASSET_COLUMNS}), instruction:instruction_id(id, legacy_uid, name)`,
    )
    .eq("legacy_uid", uid)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { error: "That inspection no longer exists." };
  const act = data as unknown as {
    id: string;
    legacy_uid: number;
    inspection_date: string;
    created_by: string | null;
    asset: AssetOption;
    instruction: CaptureContext["instruction"];
  };
  if (act.created_by !== user?.id || todayInZone(timeZone, new Date(act.inspection_date)) !== todayInZone(timeZone)) {
    return { error: "You can only edit your own inspections from today." };
  }

  const { data: values, error: valuesError } = await supabase
    .from("inspection_value")
    .select(
      "id, inspection_id, is_current, text_value, decimal_value, date_value, inspection_drop_down_option_id, " +
        "images:inspection_image(id, storage_path, thumbnail_path, mime_type, created_by, created_at)",
    )
    .eq("inspection_activity_id", act.id)
    .order("sort_order");
  if (valuesError) throw valuesError;
  type Raw = {
    id: string;
    inspection_id: string;
    is_current: boolean;
    text_value: string;
    decimal_value: number;
    date_value: string | null;
    inspection_drop_down_option_id: string | null;
    images: Parameters<typeof signImages>[1];
  };
  const raw = values as unknown as Raw[];
  const inspections = await loadInspections(supabase, [...new Set(raw.map((v) => v.inspection_id))]);
  const signed = await Promise.all(
    raw.map((v) => signImages(supabase, [...v.images].sort((a, b) => a.created_at.localeCompare(b.created_at)))),
  );

  return {
    activity: { id: act.id, legacy_uid: act.legacy_uid, inspection_date: act.inspection_date },
    asset: act.asset,
    instruction: act.instruction,
    inspections: [...inspections.values()],
    values: raw.map((v, i) => ({
      id: v.id,
      inspection_id: v.inspection_id,
      is_current: v.is_current,
      text_value: v.text_value,
      decimal_value: String(v.decimal_value),
      date_value: v.date_value ?? "",
      drop_down_option_id: v.inspection_drop_down_option_id ?? "",
      images: signed[i].map((img) => ({
        key: img.id,
        id: img.id,
        thumb_url: img.thumb_url,
        upload: null,
        uploading: false,
        error: null,
      })),
    })),
  };
}

// ACT_InspectionActivity_Save → save_inspection_activity.
export async function saveActivity(payload: SaveActivityPayload): Promise<SaveActivityResult> {
  await requireRole(INSPECTION_WRITERS);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_inspection_activity", { p_activity: payload });
  if (error) return { ok: false, error: friendlyError(error) };
  const result = data as
    | { ok: true; id: string; legacy_uid: number; removed_paths: string[] }
    | { ok: false; messages: never[]; retries: never[] };
  if (result.ok) {
    await removeFiles(supabase, result.removed_paths ?? []);
    revalidate();
    return { ok: true, id: result.id, legacy_uid: result.legacy_uid };
  }
  // An auto-created incident may have been committed (validation §3.4).
  revalidatePath("/admin/incidents");
  return result;
}
