// Services (web/src/app/m/services/service-list.tsx): open services,
// soonest due first, read-only.
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@powersync/react-native";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Text, View } from "react-native";
import { shortDate, toDate } from "../../domain/dates";
import { SERVICE_TYPE_LABELS } from "../../queries";
import { useApp } from "../../state/app-context";
import { Empty, Header, HomeBar, Row, Screen, SearchBox } from "../../ui/components";
import { colors } from "../../ui/theme";

type ServiceRow = { id: string; service_type: string; due_date: string | null; asset_name: string | null; asset_code: string | null; supplier_name: string | null };

export default function Services() {
  const { timeZone } = useApp();
  const { data } = useQuery<ServiceRow>(
    `SELECT s.id, s.service_type, s.due_date, a.name AS asset_name, a.code AS asset_code, o.name AS supplier_name
       FROM service s
       LEFT JOIN asset a ON a.id = s.asset_id
       LEFT JOIN organisation o ON o.id = s.supplier_id
      WHERE s.is_completed = 0
      ORDER BY julianday(s.due_date)`,
  );
  const [query, setQuery] = useState("");
  const [now] = useState(() => Date.now());
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? data.filter((s) => [s.asset_name, s.asset_code, SERVICE_TYPE_LABELS[s.service_type], s.supplier_name].some((v) => (v ?? "").toLowerCase().includes(q)))
      : data;
  }, [data, query]);

  return (
    <Screen bg={colors.white}>
      <Header title="Services" back />
      <SearchBox value={query} onChange={setQuery} placeholder="Search Asset, Type or Supplier" />
      <FlatList
        data={rows}
        keyExtractor={(s) => s.id}
        ListEmptyComponent={<Empty>No open services</Empty>}
        renderItem={({ item: s }) => {
          const overdue = !!s.due_date && toDate(s.due_date).getTime() < now;
          return (
            <Row onPress={() => router.push({ pathname: "/services/[id]", params: { id: s.id } })} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ fontSize: 21, fontWeight: "600", color: colors.ink }}>
                  {s.asset_name}
                </Text>
                <Text style={{ fontSize: 17, color: colors.muted }}>
                  {SERVICE_TYPE_LABELS[s.service_type] ?? s.service_type}
                  {s.supplier_name ? ` · ${s.supplier_name}` : ""}
                </Text>
                <Text style={{ marginTop: 2, fontSize: 17, color: overdue ? colors.red : colors.ink, fontWeight: overdue ? "600" : "400" }}>
                  Due {shortDate(s.due_date, timeZone)}
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
