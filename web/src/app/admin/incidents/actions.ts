"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { friendlyError } from "@/lib/db-errors";
import { INCIDENT_READERS, INCIDENT_WRITERS } from "@/lib/incidents/permissions";
import type {
  FieldErrors,
  IncidentDetail,
  IncidentImage,
  IncidentListRow,
  IncidentStatus,
  IncidentTypeOption,
  LocationOption,
  LocationStatusRow,
  NewImage,
  SaveIncidentPayload,
  StatusChange,
} from "@/lib/incidents/types";

// Same model as the other sections: every call runs with the caller's own
// session, so RLS and the RPCs' role checks are the real gate.

const BUCKET = "incident-images";
const SIGNED_URL_TTL = 60 * 60;

type ActionResult = { error: string | null };

function revalidate(reference?: number) {
  revalidatePath("/admin/incidents");
  if (reference !== undefined) revalidatePath(`/admin/incidents/${reference}`);
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

// ============================================================================
// Reads
// ============================================================================
const LIST_COLUMNS =
  "id, reference, status, comment, incident_date, completed_at, created_at, created_by, " +
  "location:location_id(id, name), " +
  "incident_type:incident_type_id(id, name, disables_location), " +
  // incident_image references both incident and incident_note, so PostgREST
  // also sees incident → incident_note through it; name the direct FK.
  "images:incident_image(count), notes:incident_note!incident_note_incident_id_fkey(count)";

type RawListRow = Omit<IncidentListRow, "image_count" | "note_count" | "created_by_name"> & {
  images: { count: number }[];
  notes: { count: number }[];
};

function toListRow(row: RawListRow, names: Map<string, string>): IncidentListRow {
  const { images, notes, ...rest } = row;
  return {
    ...rest,
    created_by_name: row.created_by ? (names.get(row.created_by) ?? null) : null,
    // Only photos on the incident itself (note photos hang off the note).
    image_count: images[0]?.count ?? 0,
    note_count: notes[0]?.count ?? 0,
  };
}

// Incident_Overview / Incident_Overview_PWA. Newest first; capped at the API's
// max_rows (1000) — the list filters client-side.
export async function listIncidents(): Promise<IncidentListRow[]> {
  await requireRole(INCIDENT_READERS);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("incident")
    .select(LIST_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw error;
  const rows = data as unknown as RawListRow[];
  const names = await userNames(supabase, rows.map((r) => r.created_by));
  return rows.map((r) => toListRow(r, names));
}

// ICD-R10: LocationStatus_Overview lists [Active][IsAssetManager] locations.
export async function listLocationStatus(): Promise<LocationStatusRow[]> {
  await requireRole(INCIDENT_READERS);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("location_status")
    .select("location_id, name, active, is_asset_manager, open_disabling_incident_count, is_operational")
    .eq("active", true)
    .eq("is_asset_manager", true)
    .order("name");
  if (error) throw error;
  return data as LocationStatusRow[];
}

export async function getAppTimeZone(): Promise<string> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("app_time_zone");
  return (data as string | null) ?? "Africa/Johannesburg";
}

// Pickers on Incident_NewEdit: every type and location, so an incident whose
// current value was deactivated still shows it. The form offers only active
// types and active asset-manager locations for new choices.
export async function listIncidentFormOptions(): Promise<{
  types: IncidentTypeOption[];
  locations: LocationOption[];
}> {
  await requireRole(INCIDENT_WRITERS);
  const supabase = await createClient();
  const [types, locations] = await Promise.all([
    supabase
      .from("incident_type")
      .select("id, name, is_image_required, disables_location, active")
      .order("name"),
    supabase.from("location").select("id, name, active, is_asset_manager").order("name"),
  ]);
  if (types.error) throw types.error;
  if (locations.error) throw locations.error;
  return { types: types.data, locations: locations.data };
}

type RawImage = {
  id: string;
  storage_path: string;
  thumbnail_path: string | null;
  mime_type: string;
  created_by: string | null;
  created_at: string;
};

async function signImages(supabase: SupabaseClient, images: RawImage[]): Promise<IncidentImage[]> {
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

// Incident_View — the read-only report, open to every role (EML-R08).
export async function getIncidentDetail(reference: number): Promise<IncidentDetail | null> {
  await requireRole(INCIDENT_READERS);
  const supabase = await createClient();

  const { data: incident, error } = await supabase
    .from("incident")
    .select(
      "id, reference, status, comment, incident_date, completed_at, created_at, updated_at, created_by, " +
        "location:location_id(id, name), " +
        "incident_type:incident_type_id(id, name, disables_location, is_image_required)",
    )
    .eq("reference", reference)
    .maybeSingle();
  if (error) throw error;
  if (!incident) return null;
  const inc = incident as unknown as Omit<
    IncidentDetail,
    "images" | "notes" | "history" | "image_count" | "note_count" | "created_by_name"
  >;

  const imageColumns = "id, storage_path, thumbnail_path, mime_type, created_by, created_at";
  const [images, notes, history] = await Promise.all([
    supabase.from("incident_image").select(imageColumns).eq("incident_id", inc.id).order("created_at"),
    // DS_IncidentNote_GetOtherIncidentNotes: newest first.
    supabase
      .from("incident_note")
      .select(`id, body, created_at, created_by, images:incident_image(${imageColumns})`)
      .eq("incident_id", inc.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("incident_status_change")
      .select("id, from_status, to_status, changed_at, changed_by")
      .eq("incident_id", inc.id)
      .order("changed_at"),
  ]);
  for (const res of [images, notes, history]) if (res.error) throw res.error;

  const rawNotes = (notes.data ?? []) as unknown as {
    id: string;
    body: string;
    created_at: string;
    created_by: string | null;
    images: RawImage[];
  }[];
  const rawHistory = (history.data ?? []) as (Omit<StatusChange, "changed_by_name"> & {
    changed_by: string | null;
  })[];

  const names = await userNames(supabase, [
    inc.created_by,
    ...rawNotes.map((n) => n.created_by),
    ...rawHistory.map((h) => h.changed_by),
  ]);

  const [directImages, ...noteImages] = await Promise.all([
    signImages(supabase, (images.data ?? []) as RawImage[]),
    ...rawNotes.map((n) =>
      signImages(
        supabase,
        [...n.images].sort((a, b) => a.created_at.localeCompare(b.created_at)),
      ),
    ),
  ]);

  return {
    ...inc,
    created_by_name: inc.created_by ? (names.get(inc.created_by) ?? null) : null,
    image_count: directImages.length,
    note_count: rawNotes.length,
    images: directImages,
    notes: rawNotes.map((n, i) => ({
      id: n.id,
      body: n.body,
      created_at: n.created_at,
      created_by: n.created_by,
      created_by_name: n.created_by ? (names.get(n.created_by) ?? null) : null,
      images: noteImages[i],
    })),
    history: rawHistory.map(({ changed_by, ...h }) => ({
      ...h,
      changed_by_name: changed_by ? (names.get(changed_by) ?? null) : null,
    })),
  };
}

// ============================================================================
// Writes
// ============================================================================
async function removeFiles(supabase: SupabaseClient, paths: string[]) {
  if (paths.length === 0) return;
  // Best effort: nothing references these any more.
  await supabase.storage.from(BUCKET).remove(paths);
}

// ACT_Incident_Save (ICD-R11). Field checks mirror Incident_Validate, with the
// type checked first (open question: Mendix read IsImageRequired through an
// empty association). save_incident() repeats every check server-side.
export async function saveIncident(
  payload: SaveIncidentPayload,
): Promise<{ error: string | null; fieldErrors?: FieldErrors; reference?: number }> {
  await requireRole(INCIDENT_WRITERS);

  const fieldErrors: FieldErrors = {};
  if (!payload.incident_type_id) fieldErrors.incident_type_id = "Required";
  if (!payload.location_id) fieldErrors.location_id = "Required";
  if (!payload.comment.trim()) fieldErrors.comment = "Required";
  if (Object.keys(fieldErrors).length > 0) return { error: null, fieldErrors };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_incident", { p_incident: payload });
  if (error) return { error: friendlyError(error) };

  const result = data as { id: string; reference: number; removed_paths: string[] };
  await removeFiles(supabase, result.removed_paths ?? []);
  revalidate(result.reference);
  return { error: null, reference: result.reference };
}

// ACT_Incident_ChangeStatus (ICD-R06).
export async function advanceIncidentStatus(
  id: string,
  expected: IncidentStatus,
  reference: number,
): Promise<ActionResult> {
  await requireRole(INCIDENT_WRITERS);
  const supabase = await createClient();
  const { error } = await supabase.rpc("advance_incident_status", {
    p_incident_id: id,
    p_expected_status: expected,
  });
  if (error) return { error: friendlyError(error) };
  revalidate(reference);
  return { error: null };
}

// ACT_Incident_ChangeStatus_R (ICD-R07), admins only.
export async function setIncidentStatus(
  id: string,
  status: IncidentStatus,
  reference: number,
): Promise<ActionResult> {
  await requireRole(["system_admin", "admin"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_incident_status", {
    p_incident_id: id,
    p_status: status,
  });
  if (error) return { error: friendlyError(error) };
  revalidate(reference);
  return { error: null };
}

// Admins only (RLS). Cascades to notes, photos and the status history; the
// photo files are removed from Storage afterwards.
export async function deleteIncident(id: string): Promise<ActionResult> {
  await requireRole(["system_admin", "admin"]);
  const supabase = await createClient();

  const { data: notes } = await supabase.from("incident_note").select("id").eq("incident_id", id);
  const noteIds = (notes ?? []).map((n) => n.id);
  const filter = noteIds.length
    ? `incident_id.eq.${id},incident_note_id.in.(${noteIds.join(",")})`
    : `incident_id.eq.${id}`;
  const { data: images } = await supabase
    .from("incident_image")
    .select("storage_path, thumbnail_path")
    .or(filter);

  const { data: deleted, error } = await supabase.from("incident").delete().eq("id", id).select("id");
  if (error) return { error: friendlyError(error) };
  if (!deleted || deleted.length === 0) {
    return { error: "You don't have permission to delete this incident." };
  }

  await removeFiles(
    supabase,
    (images ?? []).flatMap((i) => [i.storage_path, i.thumbnail_path].filter((p): p is string => !!p)),
  );
  revalidate();
  return { error: null };
}

// ACT_IncidentNote_Save: the note and its photos together (add_incident_note).
export async function addIncidentNote(
  incidentId: string,
  reference: number,
  body: string,
  images: NewImage[],
): Promise<ActionResult> {
  await requireRole(INCIDENT_WRITERS);
  // ICN-R01
  if (!body.trim()) return { error: "Note is required." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("add_incident_note", {
    p_incident_id: incidentId,
    p_body: body,
    p_images: images,
  });
  if (error) return { error: friendlyError(error) };
  revalidate(reference);
  return { error: null };
}

function slug(value: string) {
  return (
    value
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "location"
  );
}

// ACT_IncidentImage_Download (admins only, as in the source app). The file
// name keeps the real extension and a safe location slug (fixes ICI-R03).
export async function getImageDownloadUrl(
  imageId: string,
): Promise<{ error: string | null; url?: string }> {
  await requireRole(["system_admin", "admin"]);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("incident_image")
    .select(
      "storage_path, mime_type, " +
        "incident:incident_id(reference, location:location_id(name)), " +
        "note:incident_note_id(incident:incident_id(reference, location:location_id(name)))",
    )
    .eq("id", imageId)
    .maybeSingle();
  if (error || !data) return { error: "That image no longer exists." };

  type Parent = { reference: number; location: { name: string } | null } | null;
  const row = data as unknown as {
    storage_path: string;
    mime_type: string;
    incident: Parent;
    note: { incident: Parent } | null;
  };
  const parent = row.incident ?? row.note?.incident ?? null;
  const ext = row.mime_type.split("/")[1]?.replace("jpeg", "jpg") ?? "jpg";
  const name = `${parent?.reference ?? "incident"}_${slug(parent?.location?.name ?? "")}.${ext}`;

  const { data: signed, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(row.storage_path, 60, { download: name });
  if (signError || !signed) return { error: "Could not prepare the download." };
  return { error: null, url: signed.signedUrl };
}
