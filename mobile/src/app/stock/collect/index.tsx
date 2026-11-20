// Collect (MWTS spec R3): open purchase orders the office assigned to me,
// then the unassigned ones any technician can collect. From the local
// database, so a newly assigned order appears as soon as it syncs.
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@powersync/react-native";
import { router } from "expo-router";
import { useMemo } from "react";
import { FlatList, Text, View } from "react-native";
import { useApp } from "../../../state/app-context";
import { Empty, Header, HomeBar, Row, Screen } from "../../../ui/components";
import { colors } from "../../../ui/theme";

type OrderRow = {
  id: string;
  reference: number | null;
  order_alias: string | null;
  collector_user_id: string | null;
  collect_from: string | null;
  supplier_name: string | null;
  collect_area_name: string | null;
};
type LineRow = { purchase_order_id: string; qty_outstanding: number | null; item_name: string | null };

const poNumber = (ref: number | null) => (ref === null ? "PO-(new)" : `PO-${String(ref).padStart(5, "0")}`);
const qty = (n: number | null) => String(Number(n ?? 0));

export default function CollectList() {
  const { user } = useApp();
  const { data: orders } = useQuery<OrderRow>(
    `SELECT po.id, po.reference, po.order_alias, po.collector_user_id, po.collect_from,
            o.name AS supplier_name, sa.name AS collect_area_name
       FROM purchase_order po
       LEFT JOIN organisation o ON o.id = po.supplier_id
       LEFT JOIN storage_area sa ON sa.id = po.collect_from_area_id
      WHERE po.status = 'new' AND (po.collector_user_id = ? OR po.collector_user_id IS NULL)`,
    [user.id],
  );
  const { data: lines } = useQuery<LineRow>(
    `SELECT l.purchase_order_id, l.qty_outstanding, i.name AS item_name
       FROM purchase_order_item l LEFT JOIN item i ON i.id = l.item_id
      WHERE l.status = 'new' ORDER BY l.created_at`,
  );
  const rows = useMemo(
    () =>
      [...orders].sort(
        (a, b) =>
          Number(b.collector_user_id === user.id) - Number(a.collector_user_id === user.id) || (a.reference ?? 0) - (b.reference ?? 0),
      ),
    [orders, user.id],
  );

  return (
    <Screen>
      <Header title="Collect" back />
      <FlatList
        style={{ flex: 1, backgroundColor: colors.white }}
        data={rows}
        keyExtractor={(o) => o.id}
        ListEmptyComponent={<Empty>Nothing to collect</Empty>}
        renderItem={({ item: o }) => {
          const mine = o.collector_user_id === user.id;
          const from = o.collect_from === "STORAGE_AREA" ? (o.collect_area_name ?? "a storage area") : (o.supplier_name ?? "—");
          const summary = lines
            .filter((l) => l.purchase_order_id === o.id)
            .map((l) => `${qty(l.qty_outstanding)} × ${l.item_name ?? "—"}`)
            .join(", ");
          return (
            <Row onPress={() => router.push({ pathname: "/stock/collect/[id]", params: { id: o.id } })}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <Text style={{ fontSize: 21, fontWeight: "600", color: colors.ink }}>{poNumber(o.reference)}</Text>
                  <Text
                    style={{
                      fontSize: 14,
                      fontWeight: "600",
                      paddingHorizontal: 10,
                      paddingVertical: 2,
                      borderRadius: 999,
                      overflow: "hidden",
                      color: mine ? "#1f7a2e" : "#3b4aa8",
                      backgroundColor: mine ? "#e6f4e8" : "#eef0fb",
                    }}
                  >
                    {mine ? "For you" : "Anyone"}
                  </Text>
                </View>
                <Text numberOfLines={1} style={{ fontSize: 17, color: colors.muted }}>
                  From {from}
                  {o.order_alias ? ` · ${o.order_alias}` : ""}
                </Text>
                <Text numberOfLines={1} style={{ fontSize: 17, color: colors.ink }}>
                  {summary}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.ink} />
            </Row>
          );
        }}
      />
      <HomeBar />
    </Screen>
  );
}
