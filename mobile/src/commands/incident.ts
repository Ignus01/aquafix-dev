// Incidents (spec "Screens: local reads and writes" → New incident, Incident
// detail). Each action writes its local rows and queues its command in one
// transaction; the RPC (save_incident, add_incident_note,
// advance_incident_status) makes the real change on upload.
import type { CommonPowerSyncDatabase } from "@powersync/react-native";
import { INCIDENT_BUCKET } from "../config";
import { nowIso } from "../domain/dates";
import { type FormPhoto, recordFreshPhotos, toPayloadImage } from "../photos/photos";
import { newId, queueCommand, resolveAttention } from "./outbox";
import type { AdvancePayload, IncidentPayload, NotePayload } from "./types";

export type IncidentInput = { incident_type_id: string; location_id: string; comment: string; photos: FormPhoto[] };

// Incident_NewEdit's Save. The PWA's simple checks run on the form first.
export async function saveNewIncident(
  db: CommonPowerSyncDatabase,
  input: IncidentInput,
  opts: { userId: string; clientId?: string; attentionId?: string | null },
): Promise<string> {
  const capturedAt = nowIso();
  const id = opts.clientId ?? newId();
  const payload: IncidentPayload = {
    command_id: newId(),
    client_id: id,
    captured_at: capturedAt,
    incident_type_id: input.incident_type_id,
    location_id: input.location_id,
    comment: input.comment.trim(),
    images: input.photos.map(toPayloadImage),
  };
  await db.writeTransaction(async (tx) => {
    const exists = await tx.getOptional("SELECT id FROM incident WHERE id = ?", [id]);
    if (!exists) {
      await tx.execute(
        `INSERT INTO incident (id, reference, incident_date, status, completed_at, comment, location_id, incident_type_id, created_by)
         VALUES (?, NULL, ?, 'new', NULL, ?, ?, ?, ?)`,
        [id, capturedAt, payload.comment, input.location_id, input.incident_type_id, opts.userId],
      );
    }
    for (const p of input.photos) {
      if (p.serverId) continue;
      if (await tx.getOptional("SELECT id FROM incident_image WHERE id = ?", [p.photoId])) continue;
      await tx.execute(
        "INSERT INTO incident_image (id, incident_id, incident_note_id, thumbnail_path, storage_path, created_at) VALUES (?, ?, NULL, ?, ?, ?)",
        [p.photoId, id, p.thumbnail_path, p.storage_path, capturedAt],
      );
    }
    await recordFreshPhotos(tx, INCIDENT_BUCKET, input.photos, capturedAt);
    await resolveAttention(tx, opts.attentionId);
    await queueCommand(tx, { command: "save_incident", payload }, capturedAt);
  });
  return id;
}

// ICN: Add Note with photos. The note's created_at is the capture time.
export async function addNote(
  db: CommonPowerSyncDatabase,
  incidentId: string,
  body: string,
  photos: FormPhoto[],
  opts: { userId: string; noteId?: string; attentionId?: string | null },
): Promise<void> {
  const capturedAt = nowIso();
  const noteId = opts.noteId ?? newId();
  const payload: NotePayload = {
    p_incident_id: incidentId,
    p_body: body.trim(),
    p_images: photos.map(toPayloadImage),
    p_note_id: noteId,
    p_command_id: newId(),
    p_captured_at: capturedAt,
  };
  await db.writeTransaction(async (tx) => {
    if (!(await tx.getOptional("SELECT id FROM incident_note WHERE id = ?", [noteId]))) {
      await tx.execute("INSERT INTO incident_note (id, incident_id, body, created_at, created_by) VALUES (?, ?, ?, ?, ?)", [
        noteId,
        incidentId,
        payload.p_body,
        capturedAt,
        opts.userId,
      ]);
    }
    for (const p of photos) {
      if (await tx.getOptional("SELECT id FROM incident_image WHERE id = ?", [p.photoId])) continue;
      // A photo on a note has the note as its only parent.
      await tx.execute(
        "INSERT INTO incident_image (id, incident_id, incident_note_id, thumbnail_path, storage_path, created_at) VALUES (?, NULL, ?, ?, ?, ?)",
        [p.photoId, noteId, p.thumbnail_path, p.storage_path, capturedAt],
      );
    }
    await recordFreshPhotos(tx, INCIDENT_BUCKET, photos, capturedAt);
    await resolveAttention(tx, opts.attentionId);
    await queueCommand(tx, { command: "add_incident_note", payload }, capturedAt);
  });
}

// ICD-R06: Start (new → in_progress) or Complete (in_progress → completed).
// Complete sets completed_at to the time of the tap.
export async function advanceStatus(
  db: CommonPowerSyncDatabase,
  incidentId: string,
  expected: "new" | "in_progress",
  opts: { attentionId?: string | null } = {},
): Promise<void> {
  const capturedAt = nowIso();
  const target = expected === "new" ? "in_progress" : "completed";
  const payload: AdvancePayload = {
    p_incident_id: incidentId,
    p_expected_status: expected,
    p_command_id: newId(),
    p_captured_at: capturedAt,
  };
  await db.writeTransaction(async (tx) => {
    await tx.execute(
      `UPDATE incident SET status = ?, completed_at = CASE WHEN ? = 'completed' THEN ? ELSE completed_at END
        WHERE id = ? AND status = ?`,
      [target, target, capturedAt, incidentId, expected],
    );
    await resolveAttention(tx, opts.attentionId);
    await queueCommand(tx, { command: "advance_incident_status", payload }, capturedAt);
  });
}
