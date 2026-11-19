// Collect one purchase order (MWTS spec R3): the open lines, each starting
// at what is still outstanding (lower it for a short delivery), where it goes
// (the order's Deliver to), an optional delivery note and photo, and one
// button: Collected. Saved on the phone at once and sent when there is
// signal. ?attention=… re-opens a collection the server refused.
import { Ionicons } from "@expo/vector-icons";
import { usePowerSync, useQuery } from "@powersync/react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { collectPurchaseOrder, validateCollect } from "../../../commands/collect";
import { photoFileMap } from "../../../commands/inspection";
import type { AttentionMessages, CollectPayload } from "../../../commands/types";
import { STOCK_DOCUMENT_BUCKET } from "../../../config";
import { canReceive } from "../../../domain/permissions";
import { discardFreshPhotos, type FormPhoto, payloadToFormPhotos } from "../../../photos/photos";
import { useApp } from "../../../state/app-context";
import { Button, ConfirmDialog, Empty, ErrorBox, FormFooter, Header, Input, Label, Screen, SelectField } from "../../../ui/components";
import { PhotoSheet } from "../../../ui/photo-sheet";
import { useMyKit, useStockOptions } from "../../../ui/stock-fields";
import { colors } from "../../../ui/theme";

type Order = {
  id: string;
  reference: number | null;
  order_alias: string | null;
  comment: string | null;
  status: string | null;
  collect_from: string | null;
  collect_from_area_id: string | null;
  deliver_to_area_id: string | null;
  supplier_name: string | null;
};
type Line = { id: string; item_id: string; qty_ordered: number | null; qty_outstanding: number | null; status: string | null };

const plain = (n: number | null | undefined) => String(Number(n ?? 0));

export default function CollectOrder() {
  const db = usePowerSync();
  const { id, attention } = useLocalSearchParams<{ id: string; attention?: string }>();
  const { user, roles, captureBlocked, toast } = useApp();
  const options = useStockOptions(true);
  const myKit = useMyKit(user.id);
  const allOptions = useStockOptions(false);

  const { data: orders } = useQuery<Order>(
    `SELECT po.id, po.reference, po.order_alias, po.comment, po.status, po.collect_from, po.collect_from_area_id,
            po.deliver_to_area_id, o.name AS supplier_name
       FROM purchase_order po LEFT JOIN organisation o ON o.id = po.supplier_id
      WHERE po.id = ?`,
    [id],
  );
  const order = orders[0];
  const { data: allLines } = useQuery<Line>(
    "SELECT id, item_id, qty_ordered, qty_outstanding, status FROM purchase_order_item WHERE purchase_order_id = ? ORDER BY created_at",
    [id],
  );

  // Only what the technician typed; the rest falls back to the order's values.
  const [qty, setQty] = useState<Record<string, string>>({});
  const [areaTyped, setArea] = useState<string | null>(null);
  const [deliveryNote, setDeliveryNote] = useState("");
  const [photos, setPhotos] = useState<FormPhoto[]>([]);
  const [showPhotos, setShowPhotos] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [retryLineIds, setRetryLineIds] = useState<string[]>([]);

  // The lines still to collect (and, when fixing a refused collection, the ones it held).
  const lines = useMemo(
    () => allLines.filter((l) => l.status === "new" || retryLineIds.includes(l.id)),
    [allLines, retryLineIds],
  );

  // Starting values: the order's Deliver to (else my kit) and what is outstanding.
  const area = areaTyped ?? order?.deliver_to_area_id ?? myKit ?? "";
  const qtyOf = (l: Line) => qty[l.id] ?? plain(Math.max(Number(l.qty_outstanding ?? 0), 0));

  // A refused collection: its values back on the form.
  useEffect(() => {
    if (!attention) return;
    void (async () => {
      const row = await db.getOptional<{ payload: string; messages: string }>("SELECT payload, messages FROM needs_attention WHERE id = ?", [attention]);
      if (!row) return;
      const p = JSON.parse(row.payload) as CollectPayload;
      const m = JSON.parse(row.messages) as AttentionMessages;
      setArea(p.storage_area_id);
      setDeliveryNote(p.delivery_note ?? "");
      setRetryLineIds(p.lines.map((l) => l.purchase_order_item_id));
      setQty(Object.fromEntries(p.lines.map((l) => [l.purchase_order_item_id, plain(l.qty)])));
      setPhotos(
        payloadToFormPhotos(
          p.documents.map((d) => ({ storage_path: d.storage_path, thumbnail_path: d.thumbnail_path, mime_type: d.mime_type, size_bytes: d.size_bytes })),
          await photoFileMap(db),
        ),
      );
      if (m.kind === "error") setError(m.message);
    })();
  }, [attention, db]);

  const itemName = (itemId: string) => allOptions.items.find((o) => o.value === itemId)?.label ?? "—";
  const areaName = (areaId: string | null) => allOptions.storageAreas.find((o) => o.value === areaId)?.label ?? "—";

  async function collected() {
    if (!order) return;
    setError(null);
    const input = {
      purchase_order_id: order.id,
      storage_area_id: area,
      delivery_note: deliveryNote,
      lines: lines.map((l) => ({ purchase_order_item_id: l.id, qty: Number(qtyOf(l).trim() || "0") })),
    };
    const problem = validateCollect(input);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    try {
      await collectPurchaseOrder(db, { ...input, photos }, { attentionId: attention ?? null });
      toast(`${order.reference ? `PO-${String(order.reference).padStart(5, "0")}` : "Order"} collected`);
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

  if (!canReceive(roles) || !order) {
    return (
      <Screen>
        <Header title="Collect" back />
        <Empty>{!order ? "This order is no longer open." : "Your role can't collect stock."}</Empty>
      </Screen>
    );
  }

  return (
    <Screen>
      <Header title={order.reference ? `PO-${String(order.reference).padStart(5, "0")}` : "Collect"} back={() => setConfirmCancel(true)} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16 }} keyboardShouldPersistTaps="handled">
          <ErrorBox>{error}</ErrorBox>
          {captureBlocked && <ErrorBox>This version of the app is too old to save. Update it, then save again.</ErrorBox>}

          <Text style={{ fontSize: 18, color: colors.ink }}>
            <Text style={{ fontWeight: "600" }}>Supplier </Text>
            {order.supplier_name ?? "—"}
          </Text>
          {order.order_alias ? (
            <Text style={{ fontSize: 18, color: colors.ink }}>
              <Text style={{ fontWeight: "600" }}>Alias </Text>
              {order.order_alias}
            </Text>
          ) : null}
          {order.collect_from === "STORAGE_AREA" ? (
            <Text style={{ fontSize: 18, color: colors.ink }}>
              <Text style={{ fontWeight: "600" }}>Collect at </Text>
              {areaName(order.collect_from_area_id)}
            </Text>
          ) : null}
          {order.comment ? <Text style={{ fontSize: 18, color: colors.muted, marginTop: 4 }}>{order.comment}</Text> : null}

          <View style={{ marginTop: 16, borderRadius: 8, borderWidth: 1, borderColor: "#dfe2e8", backgroundColor: colors.white }}>
            {lines.map((l, idx) => (
              <View key={l.id} style={{ padding: 12, borderTopWidth: idx === 0 ? 0 : 1, borderTopColor: "#dfe2e8" }}>
                <Text style={{ fontSize: 19, fontWeight: "600", color: colors.ink }}>{itemName(l.item_id)}</Text>
                <View style={{ marginTop: 6, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <Text style={{ fontSize: 16, color: colors.muted }}>
                    Outstanding {plain(l.qty_outstanding)} of {plain(l.qty_ordered)}
                  </Text>
                  <Input
                    style={{ width: 110, textAlign: "right" }}
                    keyboardType="decimal-pad"
                    value={qtyOf(l)}
                    onChangeText={(t) => setQty((q) => ({ ...q, [l.id]: t.replace(",", ".") }))}
                    accessibilityLabel={`Collected: ${itemName(l.item_id)}`}
                  />
                </View>
              </View>
            ))}
          </View>

          <Label style={{ marginTop: 16 }}>Goes into</Label>
          <SelectField
            title="Goes into"
            value={area}
            options={options.storageAreas.map((a) => (a.value === myKit ? { ...a, label: `My kit — ${a.label}` } : a))}
            onChange={setArea}
          />

          <Label style={{ marginTop: 16 }}>Delivery note (optional)</Label>
          <Input value={deliveryNote} onChangeText={setDeliveryNote} />

          <Pressable
            onPress={() => setShowPhotos(true)}
            style={{ marginTop: 16, height: 56, borderRadius: 8, backgroundColor: "#ababab", flexDirection: "row", alignItems: "center", paddingLeft: 16, paddingRight: 8 }}
          >
            <Text style={{ flex: 1, textAlign: "center", color: colors.white, fontSize: 18, fontWeight: "600" }}>DELIVERY NOTE PHOTO</Text>
            <View style={{ height: 42, borderRadius: 6, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.blue }}>
              <Ionicons name="camera" size={20} color={colors.white} />
              <Text style={{ color: colors.white, fontSize: 18 }}>{photos.length}</Text>
            </View>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>

      <FormFooter>
        <Button title="Cancel" kind="light" disabled={saving} onPress={() => setConfirmCancel(true)} />
        <Button title={saving ? "Saving…" : "Collected"} disabled={saving || captureBlocked} onPress={collected} />
      </FormFooter>
      <ConfirmDialog open={confirmCancel} onProceed={cancel} onCancel={() => setConfirmCancel(false)} />
      <PhotoSheet
        open={showPhotos}
        title="Delivery note"
        photos={photos}
        onChange={setPhotos}
        onClose={() => setShowPhotos(false)}
        userId={user.id}
        bucket={STOCK_DOCUMENT_BUCKET}
      />
    </Screen>
  );
}
