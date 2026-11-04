// Capture form (web/src/app/m/inspections/capture/capture-form.tsx):
//   ?asset=…                  ad hoc
//   ?asset=…&instruction=…    from an instruction
//   ?activity=…               edit one of my own from today
//   ?attention=…              re-open a save the server rejected
// Everything stays in memory until Save; the shared validation runs on the
// phone with the PWA's messages, photo prompts and forced retries.
import { Ionicons } from "@expo/vector-icons";
import { usePowerSync } from "@powersync/react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { INSPECTION_BUCKET } from "../../config";
import {
  applyRetries,
  attentionCaptureContext,
  type CaptureContext,
  type CaptureInspection,
  type CaptureValue,
  editCaptureContext,
  newCaptureContext,
  saveInspection,
} from "../../commands/inspection";
import type { AttentionMessages, InspectionPayload } from "../../commands/types";
import { nowIso, shortDateTime } from "../../domain/dates";
import type { SaveMessage } from "../../domain/validation";
import { discardFreshPhotos, type FormPhoto } from "../../photos/photos";
import { useApp } from "../../state/app-context";
import {
  Button,
  ConfirmDialog,
  ErrorBox,
  ErrorLine,
  FormFooter,
  GradingPill,
  Header,
  Input,
  Loading,
  Screen,
  SelectField,
  Sheet,
} from "../../ui/components";
import { DateTimeField } from "../../ui/date-field";
import { PhotoSheet } from "../../ui/photo-sheet";
import { colors } from "../../ui/theme";

type FieldErrors = Record<string, Partial<Record<NonNullable<SaveMessage["field"]>, string>>>;

function messagesToErrors(messages: SaveMessage[]): { errors: FieldErrors; popups: string[] } {
  const errors: FieldErrors = {};
  for (const m of messages) {
    if (m.kind === "field" && m.field) errors[m.value_id] = { ...errors[m.value_id], [m.field]: m.message };
  }
  return { errors, popups: messages.filter((m) => m.kind === "popup").map((m) => m.message) };
}

export default function Capture() {
  const db = usePowerSync();
  const { user, timeZone, captureBlocked, toast } = useApp();
  const params = useLocalSearchParams<{ asset?: string; instruction?: string; activity?: string; attention?: string }>();
  const [ctx, setCtx] = useState<CaptureContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [values, setValues] = useState<CaptureValue[]>([]);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [popups, setPopups] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [photosFor, setPhotosFor] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmAdHoc, setConfirmAdHoc] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attentionActivityId, setAttentionActivityId] = useState<string | undefined>();
  const [alreadyInspected, setAlreadyInspected] = useState(false);
  const [openedAt] = useState(nowIso);

  useEffect(() => {
    let live = true;
    (async () => {
      let result;
      if (params.attention) {
        const row = await db.getOptional<{ payload: string; messages: string }>("SELECT payload, messages FROM needs_attention WHERE id = ?", [
          params.attention,
        ]);
        if (!row) {
          result = { ok: false as const, error: "That item has already been dealt with." };
        } else {
          const payload = JSON.parse(row.payload) as InspectionPayload;
          const messages = JSON.parse(row.messages) as AttentionMessages;
          result = await attentionCaptureContext(db, payload);
          if (result.ok && live) {
            setAttentionActivityId(payload.activity_id);
            let vals = result.context.values;
            if (messages.kind === "rejected") {
              const m = messagesToErrors(messages.messages as SaveMessage[]);
              setFieldErrors(m.errors);
              setPopups(m.popups);
              vals = applyRetries(vals, messages.retries);
            } else {
              setError(messages.message);
              setAlreadyInspected(/has already been Inspected/.test(messages.message));
            }
            setCtx(result.context);
            setValues(vals);
            return;
          }
        }
      } else if (params.activity) {
        result = await editCaptureContext(db, params.activity, user.id, timeZone);
      } else if (params.asset) {
        result = await newCaptureContext(db, params.asset, params.instruction ?? null);
      } else {
        result = { ok: false as const, error: "Choose an asset first." };
      }
      if (!live) return;
      if (result.ok) {
        setCtx(result.context);
        setValues(result.context.values);
      } else {
        setLoadError(result.error);
      }
    })();
    return () => {
      live = false;
    };
    // Loaded once per screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const inspections = useMemo(() => new Map((ctx?.inspections ?? []).map((i) => [i.id, i])), [ctx]);

  function update(id: string, patch: Partial<CaptureValue>) {
    setValues((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  }

  async function save() {
    if (!ctx) return;
    setError(null);
    // The PWA form's own checks on decimals before the save rules.
    const clientErrors: FieldErrors = {};
    for (const v of values) {
      const insp = inspections.get(v.inspection_id)!;
      if (insp.value_type !== "DECIMAL_VALUE" && insp.value_type !== "CUMULATIVE_VALUE") continue;
      if (v.decimal_value.trim() === "") {
        if (insp.is_required) clientErrors[v.id] = { decimal_value: "Required" };
      } else if (!Number.isFinite(Number(v.decimal_value))) {
        clientErrors[v.id] = { decimal_value: "Enter a number." };
      }
    }
    setFieldErrors(clientErrors);
    if (Object.keys(clientErrors).length > 0) return;

    setSaving(true);
    try {
      const res = await saveInspection(db, ctx, values, {
        userId: user.id,
        timeZone,
        attentionId: params.attention ?? null,
        activityId: attentionActivityId,
      });
      if (res.ok) {
        toast("Inspection saved");
        router.back();
        return;
      }
      if ("error" in res) {
        setError(res.error);
        return;
      }
      const m = messagesToErrors(res.messages);
      setFieldErrors(m.errors);
      setPopups(m.popups);
      if (res.retries.length > 0) setValues((prev) => applyRetries(prev, res.retries));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save on the phone.");
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setConfirmCancel(false);
    discardFreshPhotos(values.flatMap((v) => v.photos));
    router.back();
  }

  const title = params.attention ? "Fix Inspection" : ctx?.activity || params.activity ? "Edit Inspection" : "New Inspection";

  if (loadError) {
    return (
      <Screen>
        <Header title={title} back />
        <View style={{ padding: 24, alignItems: "center", gap: 16 }}>
          <Text style={{ fontSize: 19, textAlign: "center" }}>{loadError}</Text>
          <Button title="Back" kind="light" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }
  if (!ctx) {
    return (
      <Screen>
        <Header title={title} back />
        <Loading />
      </Screen>
    );
  }

  const photoValue = values.find((v) => v.id === photosFor) ?? null;

  return (
    <Screen>
      <Header title={title} back={() => setConfirmCancel(true)} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 12 }}>
            <Ionicons name="location" size={20} color={colors.ink} />
            <Text style={{ fontSize: 20, fontWeight: "600", color: colors.muted, textTransform: "uppercase" }}>{ctx.asset.location_name}</Text>
          </View>
          <View style={{ flexDirection: "row", gap: 16, paddingHorizontal: 16, paddingTop: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 19, fontWeight: "600", marginBottom: 6 }}>Asset</Text>
              <Text style={readonlyBox}>{ctx.asset.name}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 19, fontWeight: "600", marginBottom: 6 }}>Inspection Date</Text>
              <Text style={[readonlyBox, { textAlign: "center" }]}>{shortDateTime(ctx.activity?.inspection_date ?? openedAt, timeZone)}</Text>
            </View>
          </View>
          {ctx.instruction && (
            <Text style={{ paddingHorizontal: 16, paddingTop: 12, fontSize: 16, color: colors.muted }}>
              Instruction: {ctx.instruction.name || "(no longer on this phone)"}
            </Text>
          )}
          {captureBlocked && <ErrorBox>This version of the app is too old to save. Update it, then save again.</ErrorBox>}
          {error && (
            <View style={{ marginHorizontal: 16 }}>
              <ErrorBox>{error}</ErrorBox>
            </View>
          )}
          {alreadyInspected && ctx.instruction && !ctx.activity && (
            <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
              <Button title="Save as ad-hoc inspection" kind="dark" onPress={() => setConfirmAdHoc(true)} />
            </View>
          )}

          <View style={{ marginTop: 16, backgroundColor: colors.white }}>
            {values.length === 0 && (
              <Text style={{ padding: 16, fontSize: 17, color: colors.muted, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line }}>
                No inspections are allocated to {ctx.asset.asset_type_name}. You can still save this inspection.
              </Text>
            )}
            {values.map((v) => (
              <ValueRow
                key={v.id}
                value={v}
                inspection={inspections.get(v.inspection_id)!}
                errors={fieldErrors[v.id] ?? {}}
                timeZone={timeZone}
                disabled={saving}
                onChange={(patch) => update(v.id, patch)}
                onPhotos={() => setPhotosFor(v.id)}
              />
            ))}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <FormFooter>
        <Button title="Cancel" kind="light" disabled={saving} onPress={() => setConfirmCancel(true)} />
        <Button title={saving ? "Saving…" : "Save"} disabled={saving || captureBlocked} onPress={save} />
      </FormFooter>

      <ConfirmDialog open={confirmCancel} onProceed={cancel} onCancel={() => setConfirmCancel(false)} />
      <ConfirmDialog
        open={confirmAdHoc}
        message={`${ctx.asset.name} was already inspected for this instruction. Save this as an ad-hoc inspection instead?`}
        onProceed={() => {
          setConfirmAdHoc(false);
          setCtx({ ...ctx, instruction: null });
          setAlreadyInspected(false);
          setError(null);
        }}
        onCancel={() => setConfirmAdHoc(false)}
      />

      {photoValue && (
        <PhotoSheet
          open
          title={inspections.get(photoValue.inspection_id)!.name}
          photos={photoValue.photos}
          userId={user.id}
          bucket={INSPECTION_BUCKET}
          required={inspections.get(photoValue.inspection_id)!.nr_of_images_required}
          onClose={() => setPhotosFor(null)}
          onChange={(fn: (prev: FormPhoto[]) => FormPhoto[]) =>
            setValues((prev) => prev.map((v) => (v.id === photoValue.id ? { ...v, photos: fn(v.photos) } : v)))
          }
        />
      )}

      <Sheet
        open={popups.length > 0}
        title="Please check"
        onClose={() => setPopups([])}
        footer={<Button title="OK" onPress={() => setPopups([])} style={{ flex: 1 }} />}
      >
        <View style={{ padding: 16, gap: 12 }}>
          {popups.map((p, i) => (
            <Text key={i} style={{ borderLeftWidth: 4, borderLeftColor: colors.orange, backgroundColor: colors.white, padding: 10, fontSize: 18 }}>
              {p}
            </Text>
          ))}
        </View>
      </Sheet>
    </Screen>
  );
}

const readonlyBox = {
  borderRadius: 8,
  borderWidth: 1,
  borderColor: "#dfe2e8",
  backgroundColor: colors.disabledBg,
  paddingHorizontal: 12,
  paddingVertical: 12,
  fontSize: 18,
  color: colors.ink,
} as const;

function ValueRow({
  value,
  inspection,
  errors,
  timeZone,
  disabled,
  onChange,
  onPhotos,
}: {
  value: CaptureValue;
  inspection: CaptureInspection;
  errors: FieldErrors[string];
  timeZone: string;
  disabled: boolean;
  onChange: (patch: Partial<CaptureValue>) => void;
  onPhotos: () => void;
}) {
  const [showInfo, setShowInfo] = useState(false);
  const superseded = !value.is_current;
  const photoCount = value.photos.length;
  const options = inspection.options.filter((o) => o.active || o.id === value.drop_down_option_id);
  const chosen = inspection.options.find((o) => o.id === value.drop_down_option_id);
  const needsPhotos = photoCount < inspection.nr_of_images_required;
  const invalid = Object.keys(errors).length > 0;

  return (
    <View
      style={{
        borderTopWidth: 1,
        borderBottomWidth: 1,
        borderColor: colors.line,
        marginTop: -1,
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: superseded ? "#f4f4f6" : colors.white,
        opacity: superseded ? 0.85 : 1,
        flexDirection: "row",
        gap: 12,
        alignItems: "flex-end",
      }}
    >
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
          <Text style={{ fontSize: 20, flex: 1, color: colors.ink }}>
            {inspection.name}
            {inspection.is_required ? " *" : ""}
          </Text>
          <Pressable onPress={() => setShowInfo((s) => !s)} accessibilityLabel={`About ${inspection.name}`} hitSlop={8}>
            <Ionicons name="information-circle-outline" size={26} color="#000" />
          </Pressable>
        </View>
        {showInfo && <Text style={{ marginTop: 4, fontSize: 16, color: colors.muted }}>{inspection.description || "NA"}</Text>}
        {superseded && <Text style={{ marginTop: 4, fontSize: 14, fontWeight: "500", color: colors.amber }}>Earlier attempt — kept for the record.</Text>}

        <View style={{ marginTop: 8 }}>
          {inspection.value_type === "TEXT" && (
            <Input value={value.text_value} editable={!disabled} invalid={invalid} onChangeText={(t) => onChange({ text_value: t })} />
          )}
          {(inspection.value_type === "DECIMAL_VALUE" || inspection.value_type === "CUMULATIVE_VALUE") && (
            <Input
              value={value.decimal_value}
              keyboardType="decimal-pad"
              selectTextOnFocus
              editable={!disabled && !superseded}
              invalid={invalid}
              onChangeText={(t) => onChange({ decimal_value: t.replace(",", ".") })}
            />
          )}
          {inspection.value_type === "DATETIME" && (
            <DateTimeField value={value.date_value} timeZone={timeZone} disabled={disabled} invalid={invalid} onChange={(d) => onChange({ date_value: d })} />
          )}
          {inspection.value_type === "DROP_DOWN" && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <SelectField
                  title={inspection.name}
                  value={value.drop_down_option_id}
                  options={options.map((o) => ({ value: o.id, label: o.name }))}
                  disabled={disabled}
                  invalid={invalid}
                  onChange={(id) => onChange({ drop_down_option_id: id })}
                />
              </View>
              {chosen?.grading && <GradingPill name={chosen.grading.name} hex={chosen.grading.hex} small />}
            </View>
          )}
          {Object.values(errors).map((m, i) => (
            <ErrorLine key={i}>{m}</ErrorLine>
          ))}
        </View>
      </View>

      <View style={{ alignItems: "center", gap: 4, paddingBottom: 4 }}>
        <Pressable
          onPress={onPhotos}
          disabled={disabled}
          accessibilityLabel="Photos"
          style={{
            width: 76,
            height: 64,
            borderRadius: 6,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: needsPhotos ? colors.blue : colors.done,
            opacity: disabled ? 0.6 : 1,
          }}
        >
          <Ionicons name="camera" size={30} color={colors.white} />
        </Pressable>
        <Text style={{ fontSize: 20 }}>
          {photoCount} / {inspection.nr_of_images_required}
        </Text>
      </View>
    </View>
  );
}
