// Location Status (web/src/app/m/location-status/location-status-list.tsx):
// each asset-manager location On / Off, worked out on the phone.
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@powersync/react-native";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { LOCATION_STATUS_SQL } from "../queries";
import { Header, HomeBar, Row, Screen, SearchBox } from "../ui/components";
import { colors } from "../ui/theme";

export default function LocationStatus() {
  const { data } = useQuery<{ id: string; name: string; is_off: number }>(LOCATION_STATUS_SQL);
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? data.filter((l) => l.name.toLowerCase().includes(q)) : data;
  }, [data, query]);

  return (
    <Screen bg={colors.white}>
      <Header title="Location Status" back />
      <SearchBox value={query} onChange={setQuery} placeholder="Search Location" />
      <FlatList
        data={rows}
        keyExtractor={(l) => l.id}
        ListEmptyComponent={<Text style={{ padding: 24, fontSize: 18, color: colors.muted }}>No locations found.</Text>}
        renderItem={({ item: l }) => (
          <Row style={{ flexDirection: "row", alignItems: "center", gap: 16, paddingVertical: 16 }}>
            <Ionicons name="location" size={20} color={colors.ink} />
            <Text style={{ flex: 1, fontSize: 22, color: colors.ink }}>{l.name}</Text>
            <View style={{ borderRadius: 6, paddingHorizontal: 12, paddingVertical: 4, backgroundColor: l.is_off ? colors.off : colors.done }}>
              <Text style={{ color: colors.white, fontSize: 20, fontWeight: "600" }}>{l.is_off ? "Off" : "On"}</Text>
            </View>
            <Pressable onPress={() => router.push("/incidents")} accessibilityLabel={`Incidents for ${l.name}`} hitSlop={8}>
              <Ionicons name="pricetags-outline" size={24} color={colors.ink} />
            </Pressable>
          </Row>
        )}
      />
      <HomeBar />
    </Screen>
  );
}
