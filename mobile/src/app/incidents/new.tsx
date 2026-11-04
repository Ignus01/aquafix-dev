// New incident (web/src/app/m/incidents/new/incident-form.tsx): type,
// location, comment, photos. ?attention=… re-opens a rejected save.
import { Ionicons } from "@expo/vector-icons";
import { usePowerSync, useQuery } from "@powersync/react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { INCIDENT_BUCKET } from "../../config";
import { photoFileMap } from "../../commands/inspection";
import { saveNewIncident } from "../../commands/incident";
import type { AttentionMessages, IncidentPayload } from "../../commands/types";
import { discardFreshPhotos, type FormPhoto, payloadToFormPhotos } from "../../photos/photos";
import { ACTIVE_LOCATIONS_SQL } from "../../queries";
import { useApp } from "../../state/app-context";
import { Button, ConfirmDialog, ErrorBox, ErrorLine, FormFooter, Header, Input, Label, Screen, SelectField } from "../../ui/components";
import { PhotoSheet } from "../../ui/photo-sheet";
import { colors } from "../../ui/theme";

export default function NewIncident() {
  const db = usePowerSync();
  const { user, captureBlocked, toast } = useApp();
  const { attention } = useLocalSearchParams<{ attention?: string }>();
  const { data: types } = useQuery<{ id: string; name: string; is_image_required: number; disables_location: number }>(
    "SELECT id, name, is_image_required, disables_location FROM incident_type WHERE active = 1 ORDER BY name COLLATE NOCASE",
  );
  const { data: locations } = useQuery<{ id: string; name: string }>(ACTIVE_LOCATIONS_SQL);
  const [typeId, setTypeId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [comment, setComment] = useState("");
  const [photos, setPhotos] = useState<FormPhoto[]>([]);
  const [showPhotos, setShowPhotos] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [clientId, setClientId] = useState<string | undefined>();

  useEffect(() => {
    if (!attention) return;
    void (async () => {
      const row = await db.getOptional<{ payload: string; messages: string }>("SELECT payload, messages FROM needs_attention WHERE id = ?", [attention]);
      if (!row) return;
      const p = JSON.parse(row.payload) as IncidentPayload;
      const m = JSON.parse(row.messages) as AttentionMessages;
      setTypeId(p.incident_type_id);
      setLocationId(p.location_id);
      setComment(p.comment);
      setClientId(p.client_id);
      setPhotos(payloadToFormPhotos(p.images, await photoFileMap(db)));
      if (m.kind === "error") setError(m.message);
    })();
  }, [attention, db]);

  const selectedType = types.find((t) => t.id === typeId);
  const imageRequired = selectedType?.is_image_required === 1;

  async function save() {
    setError(null);
    const errors: Record<string, string> = {};
    if (!typeId) errors.incident_type_id = "Required";
    if (!locationId) errors.location_id = "Required";
    if (!comment.trim()) errors.comment = "Required";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    if (imageRequired && photos.length === 0) {
      setError("Please add images.");
      return;
    }
    setSaving(true);
    try {
      await saveNewIncident(db, { incident_type_id: typeId, location_id: locationId, comment, photos }, { userId: user.id, clientId, attentionId: attention ?? null });
      toast("Incident saved");
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save on the phone.");
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setConfirmCancel(false);
    discardFreshPhotos(photos);
    router.back();
  }

  return (
    <Screen>
      <Header title={attention ? "Fix Incident" : "New Incident"} back={() => setConfirmCancel(true)} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 4 }} keyboardShouldPersistTaps="handled">
          <ErrorBox>{error}</ErrorBox>
          {captureBlocked && <ErrorBox>This version of the app is too old to save. Update it, then save again.</ErrorBox>}

          <Label style={{ marginTop: 8 }}>Incident Type</Label>
          <SelectField title="Incident Type" value={typeId} options={types.map((t) => ({ value: t.id, label: t.name }))} onChange={setTypeId} invalid={!!fieldErrors.incident_type_id} />
          <ErrorLine>{fieldErrors.incident_type_id}</ErrorLine>
          {selectedType?.disables_location === 1 && (
            <Text style={{ marginTop: 6, fontSize: 15, color: colors.amber }}>While open, this incident marks its location as not operational.</Text>
          )}

          <Label style={{ marginTop: 16 }}>Location</Label>
          <SelectField title="Location" value={locationId} options={locations.map((l) => ({ value: l.id, label: l.name }))} onChange={setLocationId} invalid={!!fieldErrors.location_id} />
          <ErrorLine>{fieldErrors.location_id}</ErrorLine>

          <Label style={{ marginTop: 16 }}>Comment</Label>
          <Input multiline value={comment} onChangeText={setComment} invalid={!!fieldErrors.comment} />
          <ErrorLine>{fieldErrors.comment}</ErrorLine>

          <Pressable
            onPress={() => setShowPhotos(true)}
            style={{ marginTop: 16, height: 60, borderRadius: 8, backgroundColor: "#ababab", flexDirection: "row", alignItems: "center", paddingLeft: 16, paddingRight: 8 }}
          >
            <Text style={{ flex: 1, textAlign: "center", color: colors.white, fontSize: 20, fontWeight: "600", letterSpacing: 1 }}>INCIDENT IMAGES</Text>
            <View
              style={{
                height: 46,
                borderRadius: 6,
                paddingHorizontal: 16,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                backgroundColor: imageRequired && photos.length === 0 ? colors.orange : colors.blue,
              }}
            >
              <Ionicons name="camera" size={20} color={colors.white} />
              <Text style={{ color: colors.white, fontSize: 20 }}>{photos.length}</Text>
            </View>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      <FormFooter>
        <Button title="Cancel" kind="light" disabled={saving} onPress={() => setConfirmCancel(true)} />
        <Button title={saving ? "Saving…" : "Save"} disabled={saving || captureBlocked} onPress={save} />
      </FormFooter>
      <ConfirmDialog open={confirmCancel} onProceed={cancel} onCancel={() => setConfirmCancel(false)} />
      <PhotoSheet
        open={showPhotos}
        title="Incident Images"
        photos={photos}
        onChange={setPhotos}
        onClose={() => setShowPhotos(false)}
        userId={user.id}
        bucket={INCIDENT_BUCKET}
        required={imageRequired ? 1 : undefined}
      />
    </Screen>
  );
}
