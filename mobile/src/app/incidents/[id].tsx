// Incident detail (web/src/app/m/incidents/[reference]/incident-detail.tsx):
// type, status, location, comment, photos, notes oldest first. Start /
// Complete and Add Note work offline. ?attention=… re-opens a rejected note.
import { Ionicons } from "@expo/vector-icons";
import { usePowerSync, useQuery } from "@powersync/react-native";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { INCIDENT_BUCKET } from "../../config";
import { addNote, advanceStatus } from "../../commands/incident";
import { photoFileMap } from "../../commands/inspection";
import type { AttentionMessages, NotePayload } from "../../commands/types";
import { shortDateTime } from "../../domain/dates";
import { canAddNote, canAdvanceStatus } from "../../domain/permissions";
import { discardFreshPhotos, type FormPhoto, payloadToFormPhotos } from "../../photos/photos";
import { useApp } from "../../state/app-context";
import { Button, ConfirmDialog, Empty, ErrorLine, Header, HomeBar, Input, Screen, Sheet, StatusPill } from "../../ui/components";
import { FullImage, PhotoSheet, Thumb } from "../../ui/photo-sheet";
import { colors } from "../../ui/theme";

type Img = { id: string; incident_id: string | null; incident_note_id: string | null; storage_path: string; thumb_uri: string | null };

const ADVANCE_LABEL: Record<string, string> = { new: "Start", in_progress: "Complete" };

export default function IncidentDetail() {
  const db = usePowerSync();
  const { id, attention } = useLocalSearchParams<{ id: string; attention?: string }>();
  const { user, roles, timeZone, captureBlocked, toast } = useApp();
  const { data: rows } = useQuery<{
    id: string;
    reference: number | null;
    incident_date: string;
    status: string;
    comment: string | null;
    type_name: string | null;
    location_name: string | null;
    created_by_name: string | null;
  }>(
    `SELECT i.id, i.reference, i.incident_date, i.status, i.comment, t.name AS type_name, l.name AS location_name, p.username AS created_by_name
       FROM incident i
       LEFT JOIN incident_type t ON t.id = i.incident_type_id
       LEFT JOIN location l ON l.id = i.location_id
       LEFT JOIN profiles p ON p.id = i.created_by
      WHERE i.id = ?`,
    [id],
  );
  const { data: notes } = useQuery<{ id: string; body: string; created_at: string; created_by_name: string | null }>(
    `SELECT n.id, n.body, n.created_at, p.username AS created_by_name
       FROM incident_note n LEFT JOIN profiles p ON p.id = n.created_by
      WHERE n.incident_id = ? ORDER BY julianday(n.created_at)`,
    [id],
  );
  const { data: images } = useQuery<Img>(
    `SELECT i.id, i.incident_id, i.incident_note_id, i.storage_path, f.thumb_uri
       FROM incident_image i
       LEFT JOIN photo_file f ON f.storage_path = i.storage_path OR f.id = i.id
      WHERE i.incident_id = ? OR i.incident_note_id IN (SELECT id FROM incident_note WHERE incident_id = ?)
      ORDER BY i.created_at`,
    [id, id],
  );

  const [confirmComplete, setConfirmComplete] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteId, setNoteId] = useState<string | undefined>();
  const [body, setBody] = useState("");
  const [notePhotos, setNotePhotos] = useState<FormPhoto[]>([]);
  const [notePhotosOpen, setNotePhotosOpen] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A rejected note opens the note sheet with what was typed.
  useEffect(() => {
    if (!attention) return;
    void (async () => {
      const row = await db.getOptional<{ payload: string; messages: string }>("SELECT payload, messages FROM needs_attention WHERE id = ?", [attention]);
      if (!row) return;
      const p = JSON.parse(row.payload) as NotePayload;
      const m = JSON.parse(row.messages) as AttentionMessages;
      setBody(p.p_body);
      setNoteId(p.p_note_id);
      setNotePhotos(payloadToFormPhotos(p.p_images, await photoFileMap(db)));
      if (m.kind === "error") setNoteError(m.message);
      setNoteOpen(true);
    })();
  }, [attention, db]);

  const incident = rows[0];
  if (!incident) {
    return (
      <Screen>
        <Header title="Incident" back />
        <Empty>This incident is no longer on this phone.</Empty>
        <HomeBar />
      </Screen>
    );
  }

  const status = incident.status;
  const advanceLabel = status === "completed" ? null : ADVANCE_LABEL[status];

  async function advance() {
    setConfirmComplete(false);
    setError(null);
    setBusy(true);
    try {
      await advanceStatus(db, incident.id, status as "new" | "in_progress");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save on the phone.");
    } finally {
      setBusy(false);
    }
  }

  async function saveNote() {
    setNoteError(null);
    if (!body.trim()) {
      setNoteError("Note is required.");
      return;
    }
    setBusy(true);
    try {
      await addNote(db, incident.id, body, notePhotos, { userId: user.id, noteId, attentionId: attention ?? null });
      setNoteOpen(false);
      setBody("");
      setNotePhotos([]);
      setNoteId(undefined);
      toast("Note saved");
    } catch (e) {
      setNoteError(e instanceof Error ? e.message : "Couldn't save on the phone.");
    } finally {
      setBusy(false);
    }
  }

  function closeNote() {
    discardFreshPhotos(notePhotos);
    setNotePhotos([]);
    setBody("");
    setNoteError(null);
    setNoteOpen(false);
  }

  const gallery = (list: Img[]) =>
    list.length > 0 && (
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
        {list.map((img) => (
          <Thumb key={img.id} photo={{ thumbUri: img.thumb_uri }} size={80} onPress={() => setViewing(img.storage_path)} />
        ))}
      </View>
    );

  return (
    <Screen>
      <Header title={incident.reference ? `Incident ${incident.reference}` : "Incident"} back />
      <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
        <View style={{ backgroundColor: colors.white, padding: 16 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
            <Text style={{ fontSize: 22, fontWeight: "600", color: colors.ink, flex: 1 }}>{incident.type_name}</Text>
            <StatusPill status={status} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 }}>
            <Ionicons name="location" size={16} color={colors.ink} />
            <Text style={{ fontSize: 17, fontWeight: "600", color: colors.muted, textTransform: "uppercase" }}>{incident.location_name}</Text>
          </View>
          <Text style={{ marginTop: 4, fontSize: 16, color: colors.muted }}>
            {incident.created_by_name ?? "—"} · {shortDateTime(incident.incident_date, timeZone)}
          </Text>
          <Text style={{ marginTop: 12, fontSize: 20, color: colors.ink }}>{incident.comment}</Text>
          {gallery(images.filter((i) => i.incident_id === incident.id))}
          <ErrorLine>{error}</ErrorLine>
          <View style={{ flexDirection: "row", gap: 12, marginTop: 16 }}>
            {canAdvanceStatus(roles, status) && advanceLabel && (
              <Button
                title={advanceLabel}
                disabled={busy || captureBlocked}
                onPress={() => (status === "in_progress" ? setConfirmComplete(true) : advance())}
              />
            )}
            {canAddNote(roles, status) && <Button title="Add Note" kind="dark" disabled={captureBlocked} onPress={() => setNoteOpen(true)} />}
          </View>
        </View>

        <Text style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4, fontSize: 16, fontWeight: "600", color: colors.muted, letterSpacing: 1 }}>
          NOTES ({notes.length})
        </Text>
        <View style={{ backgroundColor: colors.white }}>
          {notes.length === 0 && <Text style={{ padding: 16, fontSize: 17, color: colors.muted }}>No notes yet.</Text>}
          {notes.map((n) => (
            <View key={n.id} style={{ borderBottomWidth: 1, borderBottomColor: "#dfe2e8", padding: 16 }}>
              <Text style={{ fontSize: 19, color: colors.ink }}>{n.body}</Text>
              <Text style={{ marginTop: 4, fontSize: 14, color: colors.muted }}>
                {n.created_by_name ?? "—"} · {shortDateTime(n.created_at, timeZone)}
              </Text>
              {gallery(images.filter((i) => i.incident_note_id === n.id))}
            </View>
          ))}
        </View>
      </ScrollView>
      <HomeBar />

      <ConfirmDialog
        open={confirmComplete}
        message={`Mark incident ${incident.reference ?? ""} as completed?`.replace("  ", " ")}
        onProceed={advance}
        onCancel={() => setConfirmComplete(false)}
      />
      <FullImage bucket={INCIDENT_BUCKET} path={viewing} onClose={() => setViewing(null)} />

      <Sheet
        open={noteOpen}
        title="Add Note"
        onClose={closeNote}
        footer={
          <View style={{ flex: 1, flexDirection: "row", justifyContent: "space-between" }}>
            <Button title="Cancel" kind="light" onPress={closeNote} />
            <Button title={busy ? "Saving…" : "Save"} disabled={busy || captureBlocked} onPress={saveNote} />
          </View>
        }
      >
        <View style={{ padding: 16, gap: 16 }}>
          <Input multiline placeholder="Note" value={body} onChangeText={setBody} />
          <ErrorLine>{noteError}</ErrorLine>
          <Button title={`Photos (${notePhotos.length})`} icon="camera" kind="dark" onPress={() => setNotePhotosOpen(true)} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {notePhotos.map((p) => (
              <Thumb key={p.key} photo={p} size={72} />
            ))}
          </View>
        </View>
        <PhotoSheet
          open={notePhotosOpen}
          title="Note Images"
          photos={notePhotos}
          onChange={setNotePhotos}
          onClose={() => setNotePhotosOpen(false)}
          userId={user.id}
          bucket={INCIDENT_BUCKET}
        />
      </Sheet>
    </Screen>
  );
}
