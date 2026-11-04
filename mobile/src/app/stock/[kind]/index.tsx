// A stock document list (web/src/app/m/stock/[kind]/page.tsx): my documents
// dated today or in the 6 days before (future dates too), newest first.
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@powersync/react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo } from "react";
import { FlatList, Text, View } from "react-native";
import { docNumber, isStockKind, STOCK_CONFIG, TRANSFER_TYPE_LABELS } from "../../../commands/stock";
import { dayOf, sevenDayWindowStart, shortDate, shortDateTime, toDate } from "../../../domain/dates";
import { canDoc } from "../../../domain/permissions";
import { useApp } from "../../../state/app-context";
import { Empty, Header, HomeBar, NewButton, Row, Screen } from "../../../ui/components";
import { useStockOptions } from "../../../ui/stock-fields";
import { colors } from "../../../ui/theme";

type Doc = Record<string, string | number | null> & { id: string; reference: number | null; comment: string | null };

export default function StockList() {
  const { kind: raw } = useLocalSearchParams<{ kind: string }>();
  const kind = isStockKind(raw) ? raw : "work-orders";
  const cfg = STOCK_CONFIG[kind];
  const { user, roles, timeZone, captureBlocked } = useApp();
  const options = useStockOptions(false);
  const { data } = useQuery<Doc>(`SELECT * FROM ${cfg.table} WHERE created_by = ?`, [user.id]);
  const start = sevenDayWindowStart(timeZone);

  const rows = useMemo(
    () =>
      data
        .filter((d) => {
          const date = d[cfg.dateKey];
          return typeof date === "string" && dayOf(date, timeZone) >= start;
        })
        .sort((a, b) => toDate(String(b[cfg.dateKey])).getTime() - toDate(String(a[cfg.dateKey])).getTime()),
    [data, cfg.dateKey, timeZone, start],
  );
  const area = new Map(options.storageAreas.map((o) => [o.value, o.label]));

  function subtitle(d: Doc): string {
    if (kind === "transfers") {
      return [
        TRANSFER_TYPE_LABELS[String(d.transfer_type)] ?? d.transfer_type,
        [area.get(String(d.from_storage_area_id)), area.get(String(d.to_storage_area_id))].filter(Boolean).join(" → "),
      ]
        .filter(Boolean)
        .join(" · ");
    }
    if (kind === "loads") return [d.driver, d.vehicle_reg_nr].filter(Boolean).join(" · ");
    return area.get(String(d.storage_area_id)) ?? "";
  }

  return (
    <Screen bg={colors.white}>
      <Header title={cfg.title} back />
      <View style={{ flex: 1 }}>
        <FlatList
          data={rows}
          keyExtractor={(d) => d.id}
          contentContainerStyle={{ paddingBottom: 96 }}
          ListEmptyComponent={<Empty>No {cfg.plural.toLowerCase()} yet</Empty>}
          renderItem={({ item: d }) => {
            const when = cfg.dateHasTime ? shortDateTime(String(d[cfg.dateKey]), timeZone) : shortDate(String(d[cfg.dateKey]), timeZone);
            const sub = subtitle(d);
            return (
              <Row
                onPress={() => router.push({ pathname: "/stock/[kind]/[id]", params: { kind, id: d.id } })}
                style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
              >
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                    <Text style={{ fontSize: 21, fontWeight: "600", color: colors.ink }}>{docNumber(kind, d.reference)}</Text>
                    <Text style={{ fontSize: 17, color: colors.ink }}>{when}</Text>
                  </View>
                  {!!sub && (
                    <Text numberOfLines={1} style={{ fontSize: 17, color: colors.muted }}>
                      {sub}
                    </Text>
                  )}
                  {!!d.comment && (
                    <Text numberOfLines={1} style={{ fontSize: 17, color: colors.ink }}>
                      {d.comment}
                    </Text>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.ink} />
              </Row>
            );
          }}
        />
        {canDoc(roles, kind, "create") && !captureBlocked && (
          <NewButton onPress={() => router.push({ pathname: "/stock/[kind]/new", params: { kind } })} />
        )}
      </View>
      <HomeBar />
    </Screen>
  );
}
