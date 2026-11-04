// Select Asset (web/src/app/m/inspections/new/[locationId]/asset-picker.tsx):
// active assets at the location, by asset type then name, with code and the
// previous inspection date.
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@powersync/react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Text, View } from "react-native";
import { shortDateTime } from "../../domain/dates";
import { useApp } from "../../state/app-context";
import { Header, HomeBar, Row, Screen, SearchBox } from "../../ui/components";
import { colors } from "../../ui/theme";

type AssetRow = { id: string; name: string; code: string | null; last_inspection_date: string | null; asset_type_name: string | null };

export default function SelectAsset() {
  const { location, instruction } = useLocalSearchParams<{ location: string; instruction?: string }>();
  const { timeZone } = useApp();
  const { data: loc } = useQuery<{ name: string }>("SELECT name FROM location WHERE id = ?", [location]);
  const { data } = useQuery<AssetRow>(
    `SELECT a.id, a.name, a.code, a.last_inspection_date, t.name AS asset_type_name
       FROM asset a LEFT JOIN asset_type t ON t.id = a.asset_type_id
      WHERE a.location_id = ? AND a.active = 1
      ORDER BY t.name COLLATE NOCASE, a.name COLLATE NOCASE`,
    [location],
  );
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? data.filter((a) => [a.name, a.code, a.asset_type_name].some((s) => (s ?? "").toLowerCase().includes(q))) : data;
  }, [data, query]);

  const line = (k: string, v: string | null) => (
    <View style={{ flexDirection: "row" }}>
      <Text style={{ width: 110, fontSize: 20, fontWeight: "600", color: colors.ink }}>{k}</Text>
      <Text style={{ flex: 1, fontSize: 20, color: colors.ink }}>{v ?? ""}</Text>
    </View>
  );

  return (
    <Screen bg={colors.white}>
      <Header title="New Inspection" back />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingTop: 12 }}>
        <Ionicons name="location" size={20} color={colors.ink} />
        <Text style={{ fontSize: 21, fontWeight: "600", color: colors.muted, textTransform: "uppercase" }}>{loc[0]?.name}</Text>
      </View>
      <SearchBox value={query} onChange={setQuery} placeholder="Search Asset or Asset Type" />
      <FlatList
        data={rows}
        keyExtractor={(a) => a.id}
        ListEmptyComponent={<Text style={{ padding: 24, fontSize: 18, color: colors.muted }}>No assets found.</Text>}
        renderItem={({ item: a }) => (
          <Row
            onPress={() =>
              router.push({ pathname: "/inspections/capture", params: { asset: a.id, ...(instruction ? { instruction } : {}) } })
            }
          >
            {line("Asset Type:", a.asset_type_name)}
            {line("Name:", a.name)}
            {line("Code:", a.code)}
            {line("Prev. Insp.", shortDateTime(a.last_inspection_date, timeZone))}
          </Row>
        )}
      />
      <HomeBar />
    </Screen>
  );
}
