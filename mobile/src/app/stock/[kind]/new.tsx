// A new stock document (web/src/app/m/stock/[kind]/new/doc-form.tsx):
// header, then "Add Item" lines. Unlike the PWA, the header and all lines
// are saved together as one command (save_stock_document).
// ?attention=… re-opens a rejected save.
import { Ionicons } from "@expo/vector-icons";
import { usePowerSync } from "@powersync/react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { newId } from "../../../commands/outbox";
import { type Field, isStockKind, saveStockDocument, STOCK_CONFIG, type StockLineInput, validateFields } from "../../../commands/stock";
import type { AttentionMessages, StockPayload } from "../../../commands/types";
import { nowIso, todayInZone } from "../../../domain/dates";
import { canDoc } from "../../../domain/permissions";
import { useApp } from "../../../state/app-context";
import { Button, ConfirmDialog, ErrorBox, FormFooter, Header, Screen, Sheet } from "../../../ui/components";
import { FieldInput, useStockOptions } from "../../../ui/stock-fields";
import { colors } from "../../../ui/theme";

type Values = Record<string, string>;

// Starting values: today / now for dates, SEND for a transfer, else empty.
function initial(fields: Field[], timeZone: string): Values {
  const v: Values = {};
  for (const f of fields) {
    if (f.type === "date") v[f.key] = todayInZone(timeZone);
    else if (f.type === "datetime") v[f.key] = nowIso();
    else if (f.type === "bool") v[f.key] = "false";
    else v[f.key] = f.key === "transfer_type" ? "SEND" : "";
  }
  return v;
}

// A payload value back into form text.
const toText = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "boolean" ? String(v) : String(v));

export default function NewStockDoc() {
  const db = usePowerSync();
  const { kind: raw, attention } = useLocalSearchParams<{ kind: string; attention?: string }>();
  const kind = isStockKind(raw) ? raw : "work-orders";
  const cfg = STOCK_CONFIG[kind];
  const lineCfg = cfg.line ?? null;
  const { user, roles, timeZone, captureBlocked, toast } = useApp();
  const options = useStockOptions(true);
  const allOptions = useStockOptions(false);

  const [values, setValues] = useState<Values>(() => initial(cfg.header, timeZone));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<StockLineInput[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<Values | null>(null);
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [saving, setSaving] = useState(false);
  const [docId, setDocId] = useState<string | undefined>();

  useEffect(() => {
    if (!attention) return;
    void (async () => {
      const row = await db.getOptional<{ payload: string; messages: string }>("SELECT payload, messages FROM needs_attention WHERE id = ?", [attention]);
      if (!row) return;
      const p = JSON.parse(row.payload) as StockPayload;
      const m = JSON.parse(row.messages) as AttentionMessages;
      const header: Values = {};
      for (const f of cfg.header) header[f.key] = toText(p.header[f.key]);
      setValues(header);
      // A rejected document was never written; new ids avoid "already saved".
      setDocId(newId());
      setLines(
        p.lines.map((l) => {
          const v: Values = {};
          for (const f of lineCfg?.fields ?? []) v[f.key] = toText(l[f.key]);
          return { key: newId(), values: v };
        }),
      );
      if (m.kind === "error") setError(m.message);
    })();
  }, [attention, db, cfg.header, lineCfg]);

  const label = (f: Field, v: string) => (f.type === "select" ? (allOptions[f.options!].find((o) => o.value === v)?.label ?? v) : v);

  async function save() {
    setError(null);
    const found = validateFields(cfg.header, values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    if (lineCfg && lines.length === 0) {
      setError("Add at least one item.");
      return;
    }
    setSaving(true);
    try {
      await saveStockDocument(db, kind, values, lines, { userId: user.id, docId, attentionId: attention ?? null });
      toast(`${cfg.label} saved`);
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save on the phone.");
    } finally {
      setSaving(false);
    }
  }

  function addLine() {
    if (!lineCfg || !adding) return;
    const found = validateFields(lineCfg.fields, adding);
    setLineErrors(found);
    if (Object.keys(found).length > 0) return;
    setLines((prev) => [...prev, { key: newId(), values: adding }]);
    setAdding(null);
  }

  if (!canDoc(roles, kind, "create")) {
    return (
      <Screen>
        <Header title={cfg.newTitle} back />
        <Text style={{ padding: 24, fontSize: 18, textAlign: "center" }}>{"Your role can't create this document."}</Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <Header title={attention ? `Fix ${cfg.label}` : cfg.newTitle} back={() => setConfirmCancel(true)} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 0 }} keyboardShouldPersistTaps="handled">
          <ErrorBox>{error}</ErrorBox>
          {captureBlocked && <ErrorBox>This version of the app is too old to save. Update it, then save again.</ErrorBox>}
          {cfg.header
            .filter((f) => !f.showWhen || f.showWhen(values))
            .map((f) => (
              <FieldInput
                key={f.key}
                field={f}
                value={values[f.key] ?? ""}
                options={options}
                error={errors[f.key]}
                timeZone={timeZone}
                onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
              />
            ))}

          {lineCfg && (
            <View style={{ marginTop: 20 }}>
              {lines.length > 0 && (
                <View style={{ marginBottom: 12, borderRadius: 8, borderWidth: 1, borderColor: "#dfe2e8", backgroundColor: colors.white }}>
                  {lines.map((l, idx) => (
                    <View
                      key={l.key}
                      style={{ flexDirection: "row", gap: 12, padding: 10, borderTopWidth: idx === 0 ? 0 : 1, borderTopColor: "#dfe2e8" }}
                    >
                      <View style={{ flex: 1 }}>
                        {lineCfg.fields
                          .filter((f) => (f.type !== "bool" || l.values[f.key] === "true") && f.type !== "datetime")
                          .map((f) => (
                            <View key={f.key} style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                              <Text style={{ fontSize: 18, color: colors.muted }}>{f.type === "bool" ? "" : f.label}</Text>
                              <Text style={{ fontSize: 18, color: colors.ink, flexShrink: 1, textAlign: "right" }}>
                                {f.type === "bool" ? f.label : label(f, l.values[f.key])}
                              </Text>
                            </View>
                          ))}
                      </View>
                      <Pressable onPress={() => setLines((prev) => prev.filter((p) => p.key !== l.key))} accessibilityLabel="Remove item" hitSlop={8}>
                        <Ionicons name="close" size={22} color={colors.ink} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}
              <Button
                title="Add Item"
                icon="add"
                kind="dark"
                disabled={saving}
                style={{ alignSelf: "flex-start" }}
                onPress={() => {
                  setLineErrors({});
                  setAdding(initial(lineCfg.fields, timeZone));
                }}
              />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <FormFooter>
        <Button title="Cancel" kind="light" disabled={saving} onPress={() => setConfirmCancel(true)} />
        <Button title={saving ? "Saving…" : "Save"} kind={kind === "transfers" ? "dark" : "green"} disabled={saving || captureBlocked} onPress={save} />
      </FormFooter>
      <ConfirmDialog
        open={confirmCancel}
        onProceed={() => {
          setConfirmCancel(false);
          router.back();
        }}
        onCancel={() => setConfirmCancel(false)}
      />

      {lineCfg && (
        <Sheet
          open={!!adding}
          title={`Add ${lineCfg.label}`}
          onClose={() => setAdding(null)}
          footer={
            <View style={{ flex: 1, flexDirection: "row", justifyContent: "space-between" }}>
              <Button title="Cancel" kind="light" onPress={() => setAdding(null)} />
              <Button title="Add" onPress={addLine} />
            </View>
          }
        >
          <View style={{ padding: 16, paddingTop: 0 }}>
            {adding &&
              lineCfg.fields.map((f) => (
                <FieldInput
                  key={f.key}
                  field={f}
                  value={adding[f.key] ?? ""}
                  options={options}
                  error={lineErrors[f.key]}
                  timeZone={timeZone}
                  onChange={(v) => setAdding((prev) => (prev ? { ...prev, [f.key]: v } : prev))}
                />
              ))}
          </View>
        </Sheet>
      )}
    </Screen>
  );
}
