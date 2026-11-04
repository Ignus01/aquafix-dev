// Select Location (web/src/app/m/inspections/new/location-picker.tsx):
// active locations with is_asset_manager, by name.
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@powersync/react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Text } from "react-native";
import { ACTIVE_LOCATIONS_SQL } from "../../queries";
import { Header, HomeBar, Row, Screen, SearchBox } from "../../ui/components";
import { colors } from "../../ui/theme";

export default function SelectLocation() {
  const { instruction } = useLocalSearchParams<{ instruction?: string }>();
  const { data } = useQuery<{ id: string; name: string }>(ACTIVE_LOCATIONS_SQL);
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? data.filter((l) => l.name.toLowerCase().includes(q)) : data;
  }, [data, query]);

  return (
    <Screen bg={colors.white}>
      <Header title="New Inspection" back />
      <Text style={{ paddingTop: 12, textAlign: "center", fontSize: 22, fontWeight: "600", color: colors.muted, letterSpacing: 1 }}>
        SELECT LOCATION
      </Text>
      <SearchBox value={query} onChange={setQuery} placeholder="Search Location" />
      <FlatList
        data={rows}
        keyExtractor={(l) => l.id}
        ListEmptyComponent={<Text style={{ padding: 24, fontSize: 18, color: colors.muted }}>No locations found.</Text>}
        renderItem={({ item: l }) => (
          <Row
            style={{ flexDirection: "row", alignItems: "center", gap: 16, paddingVertical: 16 }}
            onPress={() => router.push({ pathname: "/inspections/assets", params: { location: l.id, ...(instruction ? { instruction } : {}) } })}
          >
            <Ionicons name="location" size={20} color={colors.ink} />
            <Text style={{ fontSize: 21, color: colors.ink, flex: 1 }}>{l.name}</Text>
          </Row>
        )}
      />
      <HomeBar />
    </Screen>
  );
}
