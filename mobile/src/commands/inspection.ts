// Inspection capture (spec "Inspection capture, step by step" and "Screens:
// local reads and writes" → Capture, new / edit). Reads the form from the
// local database, runs the shared validation, and on success writes the
// activity, its values and photos, the instruction progress, the cumulative
// store and asset.last_inspection_date, plus the outbox row, in one
// transaction.
import type { CommonPowerSyncDatabase, Transaction } from "@powersync/react-native";
import { INSPECTION_BUCKET } from "../config";
import { dayOf, nowIso } from "../domain/dates";
import {
  activityGrading,
  autoIncidentComment,
  displayValue,
  type FeedbackDef,
  type FormValue,
  type GradingDef,
  type InspectionDef,
  type OptionDef,
  type RuleDef,
  type SaveMessage,
  type SaveRetry,
  type StoredValue,
  validateActivity,
  valueGrading,
  type ValueType,
} from "../domain/validation";
import { type FormPhoto, payloadToFormPhotos, photoIdFromPath, recordFreshPhotos, rowsToFormPhotos, toPayloadImage } from "../photos/photos";
import { newId, queueCommand, resolveAttention } from "./outbox";
import type { InspectionPayload } from "./types";

export type CaptureOption = { id: string; name: string; active: boolean; grading: Pill | null };
export type Pill = { name: string; hex: string | null };
export type CaptureInspection = InspectionDef & { description: string; options: CaptureOption[] };

// One value row on the form, held in memory until Save.
export type CaptureValue = {
  id: string;
  inspection_id: string;
  is_current: boolean;
  text_value: string;
  decimal_value: string; // as typed
  date_value: string; // ISO, or ""
  drop_down_option_id: string;
  photos: FormPhoto[];
};

export type CaptureContext = {
  activity: { id: string; inspection_date: string; created_by: string | null } | null;
  asset: { id: string; name: string; code: string; location_id: string; location_name: string; asset_type_name: string };
  instruction: { id: string; name: string; legacy_uid: number | null } | null;
  inspections: CaptureInspection[];
  values: CaptureValue[];
  stored: Map<string, StoredValue>;
};

const bool = (v: unknown) => v === 1 || v === true || v === "1" || v === "true";

async function loadAsset(db: CommonPowerSyncDatabase, assetId: string) {
  return db.getOptional<CaptureContext["asset"] & { asset_type_id: string }>(
    `SELECT a.id, a.name, coalesce(a.code, '') AS code, a.location_id, a.asset_type_id,
            coalesce(l.name, '') AS location_name, coalesce(t.name, '') AS asset_type_name
       FROM asset a
       LEFT JOIN location l ON l.id = a.location_id
       LEFT JOIN asset_type t ON t.id = a.asset_type_id
      WHERE a.id = ?`,
    [assetId],
  );
}

async function loadInspections(db: CommonPowerSyncDatabase, ids: string[]): Promise<Map<string, CaptureInspection>> {
  const map = new Map<string, CaptureInspection>();
  if (ids.length === 0) return map;
  const marks = ids.map(() => "?").join(",");
  const rows = await db.getAll<{
    id: string;
    name: string;
    description: string | null;
    value_type: ValueType;
    is_required: number;
    nr_of_images_required: number;
  }>(`SELECT id, name, description, value_type, is_required, nr_of_images_required FROM inspection WHERE id IN (${marks})`, ids);
  const options = await db.getAll<{
    id: string;
    inspection_id: string;
    name: string;
    active: number;
    priority: number;
    grading_name: string | null;
    hex: string | null;
  }>(
    `SELECT o.id, o.inspection_id, o.name, o.active, coalesce(o.priority, 0) AS priority,
            g.name AS grading_name, c.hex_colour AS hex
       FROM inspection_drop_down_option o
       LEFT JOIN grading g ON g.id = o.grading_id
       LEFT JOIN colour_container c ON c.id = g.colour_container_id
      WHERE o.inspection_id IN (${marks})
      ORDER BY coalesce(o.priority, 0), o.name`,
    ids,
  );
  for (const r of rows) {
    map.set(r.id, {
      id: r.id,
      name: r.name,
      description: r.description ?? "",
      value_type: r.value_type,
      is_required: bool(r.is_required),
      nr_of_images_required: r.nr_of_images_required ?? 0,
      options: options
        .filter((o) => o.inspection_id === r.id)
        .map((o) => ({
          id: o.id,
          name: o.name,
          active: bool(o.active),
          grading: o.grading_name ? { name: o.grading_name, hex: o.hex } : null,
        })),
    });
  }
  return map;
}

function blankValue(inspectionId: string, id = newId()): CaptureValue {
  return {
    id,
    inspection_id: inspectionId,
    is_current: true,
    text_value: "",
    decimal_value: "0",
    date_value: "",
    drop_down_option_id: "",
    photos: [],
  };
}

export type ContextResult = { ok: true; context: CaptureContext } | { ok: false; error: string };

// ACT_InspectionActivity_New (IAC-R01): one value per inspection allocated to
// the asset's type, in allocation priority order. [AS-IS] Inactive
// inspections that are still allocated are asked too.
export async function newCaptureContext(
  db: CommonPowerSyncDatabase,
  assetId: string,
  instructionId: string | null,
): Promise<ContextResult> {
  const asset = await loadAsset(db, assetId);
  if (!asset) return { ok: false, error: "That asset no longer exists." };

  let instruction: CaptureContext["instruction"] = null;
  if (instructionId) {
    const alloc = await db.getOptional<{ is_completed: number; id: string; name: string; legacy_uid: number | null }>(
      `SELECT a.is_completed, i.id, i.name, i.legacy_uid
         FROM instruction_asset_allocation a JOIN instruction i ON i.id = a.instruction_id
        WHERE a.instruction_id = ? AND a.asset_id = ?`,
      [instructionId, assetId],
    );
    if (!alloc) return { ok: false, error: "This asset is not on that instruction." };
    // INS-R07: a completed allocation can't be inspected again.
    if (bool(alloc.is_completed)) return { ok: false, error: `${asset.name} has already been Inspected.` };
    instruction = { id: alloc.id, name: alloc.name, legacy_uid: alloc.legacy_uid };
  }

  const allocations = await db.getAll<{ inspection_id: string }>(
    "SELECT inspection_id FROM inspection_allocation WHERE asset_type_id = ? ORDER BY coalesce(priority, 0)",
    [asset.asset_type_id],
  );
  const ids = allocations.map((a) => a.inspection_id);
  const inspections = await loadInspections(db, ids);
  const values = ids.filter((id) => inspections.has(id)).map((id) => blankValue(id));
  return {
    ok: true,
    context: { activity: null, asset, instruction, inspections: [...inspections.values()], values, stored: new Map() },
  };
}

// IAC-R06: reopen one of my own activities from today.
export async function editCaptureContext(
  db: CommonPowerSyncDatabase,
  activityId: string,
  userId: string,
  timeZone: string,
): Promise<ContextResult> {
  const act = await db.getOptional<{ id: string; asset_id: string; instruction_id: string | null; inspection_date: string; created_by: string | null }>(
    "SELECT id, asset_id, instruction_id, inspection_date, created_by FROM inspection_activity WHERE id = ?",
    [activityId],
  );
  if (!act) return { ok: false, error: "That inspection no longer exists." };
  if (act.created_by !== userId || dayOf(act.inspection_date, timeZone) !== dayOf(nowIso(), timeZone)) {
    return { ok: false, error: "You can only edit your own inspections from today." };
  }
  const asset = await loadAsset(db, act.asset_id);
  if (!asset) return { ok: false, error: "That asset no longer exists." };
  const instruction = act.instruction_id
    ? await db.getOptional<{ id: string; name: string; legacy_uid: number | null }>(
        "SELECT id, name, legacy_uid FROM instruction WHERE id = ?",
        [act.instruction_id],
      )
    : null;

  const rows = await db.getAll<{
    id: string;
    inspection_id: string;
    is_current: number;
    text_value: string | null;
    decimal_value: number | null;
    date_value: string | null;
    inspection_drop_down_option_id: string | null;
  }>(
    `SELECT id, inspection_id, is_current, text_value, decimal_value, date_value, inspection_drop_down_option_id
       FROM inspection_value WHERE inspection_activity_id = ? ORDER BY coalesce(sort_order, 0)`,
    [act.id],
  );
  const images = await db.getAll<{ id: string; inspection_value_id: string; storage_path: string; thumbnail_path: string | null; created_at: string | null }>(
    `SELECT i.id, i.inspection_value_id, i.storage_path, i.thumbnail_path, i.created_at
       FROM inspection_image i JOIN inspection_value v ON v.id = i.inspection_value_id
      WHERE v.inspection_activity_id = ? ORDER BY i.created_at`,
    [act.id],
  );
  const files = await photoFileMap(db);
  const inspections = await loadInspections(db, [...new Set(rows.map((r) => r.inspection_id))]);

  const values: CaptureValue[] = rows.map((r) => ({
    id: r.id,
    inspection_id: r.inspection_id,
    is_current: bool(r.is_current),
    text_value: r.text_value ?? "",
    decimal_value: String(r.decimal_value ?? 0),
    date_value: r.date_value ?? "",
    drop_down_option_id: r.inspection_drop_down_option_id ?? "",
    photos: rowsToFormPhotos(
      images.filter((i) => i.inspection_value_id === r.id),
      files,
    ),
  }));
  const stored = new Map<string, StoredValue>(
    rows.map((r) => [r.id, { id: r.id, inspection_id: r.inspection_id, is_current: bool(r.is_current), decimal_value: r.decimal_value ?? 0 }]),
  );
  return {
    ok: true,
    context: {
      activity: { id: act.id, inspection_date: act.inspection_date, created_by: act.created_by },
      asset,
      instruction: instruction ?? null,
      inspections: [...inspections.values()],
      values,
      stored,
    },
  };
}

export async function photoFileMap(db: CommonPowerSyncDatabase) {
  const files = await db.getAll<{ id: string; thumb_uri: string | null; local_uri: string | null; size_bytes: number | null }>(
    "SELECT id, thumb_uri, local_uri, size_bytes FROM photo_file",
  );
  return new Map(files.map((f) => [f.id, { ...f, size_bytes: f.size_bytes ?? 1 }]));
}

export function retryValue(r: SaveRetry): CaptureValue {
  return blankValue(r.inspection_id, r.new_id);
}

// Applies Feedback retries to the form: each superseded value goes read-only
// and a fresh row is added under it (C4).
export function applyRetries(values: CaptureValue[], retries: SaveRetry[]): CaptureValue[] {
  let next = [...values];
  for (const r of retries) {
    next = next.flatMap((v) => (v.id === r.superseded_id ? [{ ...v, is_current: false }, retryValue(r)] : [v]));
  }
  return next;
}

// ---- Save ------------------------------------------------------------------------
export type SaveOutcome =
  | { ok: true; activityId: string }
  | { ok: false; messages: SaveMessage[]; retries: SaveRetry[] }
  | { ok: false; error: string };

async function referenceData(db: CommonPowerSyncDatabase, inspectionIds: string[]) {
  const marks = inspectionIds.map(() => "?").join(",") || "''";
  const [rules, feedback, options, gradings] = await Promise.all([
    db.getAll<RuleDef>(
      `SELECT id, legacy_uid, inspection_id, lower_limit, upper_limit, coalesce(nr_of_images_required, 0) AS nr_of_images_required, grading_id
         FROM inspection_rule WHERE inspection_id IN (${marks})`,
      inspectionIds,
    ),
    db.getAll<FeedbackDef & { auto_create_incident: number | boolean }>(
      "SELECT id, inspection_rule_id, feedback, coalesce(max_nr_of_retries, 0) AS max_nr_of_retries, auto_create_incident, incident_type_id FROM feedback",
    ),
    db.getAll<OptionDef>(`SELECT id, inspection_id, name, grading_id FROM inspection_drop_down_option WHERE inspection_id IN (${marks})`, inspectionIds),
    db.getAll<GradingDef>("SELECT id, coalesce(priority, 0) AS priority, legacy_uid FROM grading"),
  ]);
  return {
    rules,
    feedback: feedback.map((f) => ({ ...f, auto_create_incident: bool(f.auto_create_incident) })),
    options: new Map(options.map((o) => [o.id, o])),
    gradings: new Map(gradings.map((g) => [g.id, g])),
  };
}

// A5 offline: the highest current reading of the inspection on this asset in
// other activities captured before this one; else the cumulative store; else 0.
async function previousReadings(
  db: CommonPowerSyncDatabase,
  assetId: string,
  activityId: string,
  capturedAt: string,
  inspectionIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const id of inspectionIds) {
    const earlier = await db.getOptional<{ m: number | null }>(
      `SELECT max(v.decimal_value) AS m
         FROM inspection_value v JOIN inspection_activity a ON a.id = v.inspection_activity_id
        WHERE v.inspection_id = ? AND a.asset_id = ? AND v.is_current = 1
          AND julianday(a.inspection_date) < julianday(?) AND a.id != ?`,
      [id, assetId, capturedAt, activityId],
    );
    if (earlier?.m !== null && earlier?.m !== undefined) {
      out.set(id, earlier.m);
      continue;
    }
    const store = await db.getOptional<{ latest_value: number | null }>(
      "SELECT latest_value FROM inspection_cumulative_value WHERE inspection_id = ? AND asset_id = ?",
      [id, assetId],
    );
    out.set(id, store?.latest_value ?? 0);
  }
  return out;
}

export async function saveInspection(
  db: CommonPowerSyncDatabase,
  ctx: CaptureContext,
  formValues: CaptureValue[],
  opts: { userId: string; timeZone: string; attentionId?: string | null; activityId?: string },
): Promise<SaveOutcome> {
  const capturedAt = nowIso();
  const activityId = ctx.activity?.id ?? opts.activityId ?? newId();
  const inspections = new Map(ctx.inspections.map((i) => [i.id, i]));
  for (const v of formValues) {
    if (!inspections.has(v.inspection_id)) {
      return { ok: false, error: "An inspection on this form no longer exists — reload and try again." };
    }
  }

  // The values as the payload sends them.
  const values: FormValue[] = formValues.map((v) => ({
    id: v.id,
    inspection_id: v.inspection_id,
    is_current: v.is_current,
    text_value: v.text_value,
    decimal_value: v.decimal_value.trim() === "" ? 0 : Number(v.decimal_value),
    date_value: v.date_value || null,
    drop_down_option_id: v.drop_down_option_id || null,
    image_count: v.photos.length,
  }));

  const inspectionIds = [...inspections.keys()];
  const ref = await referenceData(db, inspectionIds);
  const cumulativeIds = ctx.inspections.filter((i) => i.value_type === "CUMULATIVE_VALUE").map((i) => i.id);
  const previous = await previousReadings(db, ctx.asset.id, activityId, capturedAt, cumulativeIds);

  const result = validateActivity({
    values,
    inspections,
    rules: ref.rules,
    feedback: ref.feedback,
    stored: ctx.stored,
    previousCumulative: (id) => previous.get(id) ?? 0,
    newId,
  });
  if (!result.ok) return { ok: false, messages: result.messages, retries: result.retries };

  const normalised = result.values;
  const payload: InspectionPayload = {
    command_id: newId(),
    captured_at: capturedAt,
    activity_id: activityId,
    asset_id: ctx.asset.id,
    instruction_id: ctx.activity ? null : (ctx.instruction?.id ?? null),
    values: normalised.map((v, i) => ({
      id: v.id,
      inspection_id: v.inspection_id,
      is_current: v.is_current,
      text_value: v.text_value,
      decimal_value: v.decimal_value,
      date_value: v.date_value,
      drop_down_option_id: v.drop_down_option_id,
      images: formValues[i].photos.map(toPayloadImage),
    })),
  };

  const valueGradings = normalised.map((v) => valueGrading(v, inspections.get(v.inspection_id)!, ref.options, ref.rules));
  const gradingId = activityGrading(valueGradings, ref.gradings);

  await db.writeTransaction(async (tx) => {
    await writeActivity(tx, {
      ctx,
      activityId,
      capturedAt,
      userId: opts.userId,
      gradingId,
      timeZone: opts.timeZone,
      normalised,
      formValues,
      valueGradings,
      options: ref.options,
    });

    // C5: show the auto-created incident at once; the server makes the real
    // one (with its own id) and the next sync replaces this copy.
    for (const inc of result.autoIncidents) {
      if (!inc.incident_type_id) continue;
      const insp = inspections.get(inc.inspection_id)!;
      await tx.execute(
        `INSERT INTO incident (id, reference, incident_date, status, completed_at, comment, location_id, incident_type_id, created_by)
         VALUES (?, NULL, ?, 'new', NULL, ?, ?, ?, ?)`,
        [newId(), capturedAt, autoIncidentComment(ctx.asset.name, insp.name, inc.decimal_value), ctx.asset.location_id, inc.incident_type_id, opts.userId],
      );
    }

    await recordFreshPhotos(tx, INSPECTION_BUCKET, formValues.flatMap((v) => v.photos), capturedAt);
    await resolveAttention(tx, opts.attentionId);
    await queueCommand(tx, { command: "save_inspection_activity", payload }, capturedAt);
  });

  return { ok: true, activityId };
}

async function writeActivity(
  tx: Transaction,
  a: {
    ctx: CaptureContext;
    activityId: string;
    capturedAt: string;
    userId: string;
    gradingId: string | null;
    timeZone: string;
    normalised: ReturnType<typeof validateActivity> extends infer R ? (R extends { ok: true; values: infer V } ? V : never) : never;
    formValues: CaptureValue[];
    valueGradings: (string | null)[];
    options: Map<string, OptionDef>;
  },
): Promise<void> {
  const { ctx, activityId, capturedAt } = a;
  const existing = await tx.getOptional<{ id: string }>("SELECT id FROM inspection_activity WHERE id = ?", [activityId]);
  if (existing) {
    // An edit moves inspection_date to the edit's capture time.
    await tx.execute("UPDATE inspection_activity SET inspection_date = ?, grading_id = ? WHERE id = ?", [capturedAt, a.gradingId, activityId]);
  } else {
    await tx.execute(
      `INSERT INTO inspection_activity (id, legacy_uid, asset_id, instruction_id, grading_id, inspection_date, created_by)
       VALUES (?, NULL, ?, ?, ?, ?, ?)`,
      [activityId, ctx.asset.id, ctx.instruction?.id ?? null, a.gradingId, capturedAt, a.userId],
    );
  }

  for (let i = 0; i < a.normalised.length; i++) {
    const v = a.normalised[i];
    const insp = ctx.inspections.find((x) => x.id === v.inspection_id)!;
    const grading = a.valueGradings[i];
    const display = displayValue(v, insp.value_type, a.options, a.timeZone);
    const row = await tx.getOptional<{ grading_id: string | null }>("SELECT grading_id FROM inspection_value WHERE id = ?", [v.id]);
    // Other types leave an existing value's grading unchanged.
    const keepGrading = insp.value_type !== "DROP_DOWN" && insp.value_type !== "DECIMAL_VALUE";
    const gradingId = keepGrading && row ? row.grading_id : grading;
    if (row) {
      await tx.execute(
        `UPDATE inspection_value SET inspection_drop_down_option_id = ?, grading_id = ?, text_value = ?, decimal_value = ?,
                date_value = ?, display_value = ?, is_current = ?, sort_order = ? WHERE id = ?`,
        [v.drop_down_option_id, gradingId, v.text_value, v.decimal_value, v.date_value, display, v.is_current ? 1 : 0, i + 1, v.id],
      );
    } else {
      await tx.execute(
        `INSERT INTO inspection_value (id, inspection_activity_id, inspection_id, inspection_drop_down_option_id, grading_id,
                text_value, decimal_value, date_value, display_value, is_current, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [v.id, activityId, v.inspection_id, v.drop_down_option_id, gradingId, v.text_value, v.decimal_value, v.date_value, display, v.is_current ? 1 : 0, i + 1],
      );
    }

    // Photos: the ones kept by id stay, others on the value are removed, new
    // ones are added with the photo id as their local row id.
    const photos = a.formValues[i].photos;
    const keep = photos.map((p) => p.serverId ?? p.photoId);
    const current = await tx.getAll<{ id: string }>("SELECT id FROM inspection_image WHERE inspection_value_id = ?", [v.id]);
    for (const c of current) {
      if (!keep.includes(c.id)) await tx.execute("DELETE FROM inspection_image WHERE id = ?", [c.id]);
    }
    for (const p of photos) {
      if (p.serverId || current.some((c) => c.id === p.photoId)) continue;
      await tx.execute(
        "INSERT INTO inspection_image (id, inspection_value_id, thumbnail_path, storage_path, created_at) VALUES (?, ?, ?, ?, ?)",
        [p.photoId, v.id, p.thumbnail_path, p.storage_path, capturedAt],
      );
    }

    // §5.2 Cumulative store: only moves forward for phone saves.
    if (insp.value_type === "CUMULATIVE_VALUE") {
      const store = await tx.getOptional<{ id: string; latest_value: number | null }>(
        "SELECT id, latest_value FROM inspection_cumulative_value WHERE inspection_id = ? AND asset_id = ?",
        [v.inspection_id, ctx.asset.id],
      );
      if (store) {
        if ((store.latest_value ?? 0) < v.decimal_value) {
          await tx.execute("UPDATE inspection_cumulative_value SET latest_value = ? WHERE id = ?", [v.decimal_value, store.id]);
        }
      } else {
        await tx.execute("INSERT INTO inspection_cumulative_value (id, inspection_id, asset_id, latest_value) VALUES (uuid(), ?, ?, ?)", [
          v.inspection_id,
          ctx.asset.id,
          v.decimal_value,
        ]);
      }
    }
  }

  // §5.3 Instruction progress (new activity from an instruction).
  if (!existing && ctx.instruction) {
    const alloc = await tx.getOptional<{ id: string; is_completed: number }>(
      "SELECT id, is_completed FROM instruction_asset_allocation WHERE instruction_id = ? AND asset_id = ?",
      [ctx.instruction.id, ctx.asset.id],
    );
    if (alloc && !bool(alloc.is_completed)) {
      await tx.execute("UPDATE instruction_asset_allocation SET is_completed = 1 WHERE id = ?", [alloc.id]);
      await tx.execute(
        `UPDATE instruction SET nr_completed = coalesce(nr_completed, 0) + 1,
                status = CASE WHEN coalesce(nr_completed, 0) + 1 >= coalesce(nr_of_allocations, 0) THEN 'completed' ELSE 'in_progress' END
          WHERE id = ?`,
        [ctx.instruction.id],
      );
    }
  }

  // §5.4 asset.last_inspection_date only moves forward.
  await tx.execute(
    `UPDATE asset SET last_inspection_date = ?
      WHERE id = ? AND (last_inspection_date IS NULL OR julianday(last_inspection_date) < julianday(?))`,
    [capturedAt, ctx.asset.id, capturedAt],
  );
}

// Needs attention → the original form, rebuilt from the command's payload
// (the local rows may already have left the phone after the rejection).
export async function attentionCaptureContext(db: CommonPowerSyncDatabase, payload: InspectionPayload): Promise<ContextResult> {
  const local = await db.getOptional<{ id: string; asset_id: string; instruction_id: string | null; inspection_date: string; created_by: string | null }>(
    "SELECT id, asset_id, instruction_id, inspection_date, created_by FROM inspection_activity WHERE id = ?",
    [payload.activity_id],
  );
  const asset = await loadAsset(db, local?.asset_id ?? payload.asset_id);
  if (!asset) return { ok: false, error: "That asset no longer exists." };

  const instructionId = local?.instruction_id ?? payload.instruction_id;
  let instruction: CaptureContext["instruction"] = null;
  if (instructionId) {
    const row = await db.getOptional<{ id: string; name: string; legacy_uid: number | null }>(
      "SELECT id, name, legacy_uid FROM instruction WHERE id = ?",
      [instructionId],
    );
    instruction = row ?? { id: instructionId, name: "", legacy_uid: null };
  }

  const inspections = await loadInspections(db, [...new Set(payload.values.map((v) => v.inspection_id))]);
  const files = await photoFileMap(db);
  const values: CaptureValue[] = payload.values
    .filter((v) => inspections.has(v.inspection_id))
    .map((v) => ({
      id: v.id,
      inspection_id: v.inspection_id,
      is_current: v.is_current,
      text_value: v.text_value ?? "",
      decimal_value: String(v.decimal_value ?? 0),
      date_value: v.date_value ?? "",
      drop_down_option_id: v.drop_down_option_id ?? "",
      photos: payloadToFormPhotos(v.images, files),
    }));

  // A server photo kept by id: show its cached thumbnail when the row is here.
  for (const v of values) {
    for (const p of v.photos) {
      if (!p.serverId) continue;
      const row = await db.getOptional<{ storage_path: string; thumbnail_path: string | null }>(
        "SELECT storage_path, thumbnail_path FROM inspection_image WHERE id = ?",
        [p.serverId],
      );
      if (!row) continue;
      p.storage_path = row.storage_path;
      p.thumbnail_path = row.thumbnail_path ?? row.storage_path;
      p.photoId = photoIdFromPath(row.storage_path);
      p.thumbUri = files.get(p.photoId)?.thumb_uri ?? null;
    }
  }

  let stored = new Map<string, StoredValue>();
  if (local) {
    const rows = await db.getAll<{ id: string; inspection_id: string; is_current: number; decimal_value: number | null }>(
      "SELECT id, inspection_id, is_current, decimal_value FROM inspection_value WHERE inspection_activity_id = ?",
      [local.id],
    );
    stored = new Map(rows.map((r) => [r.id, { id: r.id, inspection_id: r.inspection_id, is_current: bool(r.is_current), decimal_value: r.decimal_value ?? 0 }]));
  }

  return {
    ok: true,
    context: {
      activity: local ? { id: local.id, inspection_date: local.inspection_date, created_by: local.created_by } : null,
      asset,
      instruction,
      inspections: [...inspections.values()],
      values,
      stored,
    },
  };
}
