// Inspection Overview (web/src/app/m/inspections/overview.tsx): my
// activities from today, newest first, search on location / asset / asset
// type, grading pill. Tap opens Edit; New opens Select Location.
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@powersync/react-native";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Text, View } from "react-native";
import { shortDateTime, startOfTodayIso } from "../../domain/dates";
import { useApp } from "../../state/app-context";
import { Empty, GradingPill, Header, HomeBar, NewButton, Row, Screen, SearchBox } from "../../ui/components";
import { colors } from "../../ui/theme";

type ActivityRow = {
  id: string;
  inspection_date: string;
  asset_name: string | null;
  location_name: string | null;
  asset_type_name: string | null;
  grading_name: string | null;
  hex: string | null;
};

export default function InspectionOverview() {
  const { user, timeZone, captureBlocked } = useApp();
  const since = useMemo(() => startOfTodayIso(timeZone), [timeZone]);
  const { data } = useQuery<ActivityRow>(
    `SELECT a.id, a.inspection_date, s.name AS asset_name, l.name AS location_name, t.name AS asset_type_name,
            g.name AS grading_name, c.hex_colour AS hex
       FROM inspection_activity a
       LEFT JOIN asset s ON s.id = a.asset_id
       LEFT JOIN location l ON l.id = s.location_id
       LEFT JOIN asset_type t ON t.id = s.asset_type_id
       LEFT JOIN grading g ON g.id = a.grading_id
       LEFT JOIN colour_container c ON c.id = g.colour_container_id
      WHERE a.created_by = ? AND julianday(a.inspection_date) >= julianday(?)
      ORDER BY julianday(a.inspection_date) DESC`,
    [user.id, since],
  );
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return data;
    return data.filter((a) => [a.location_name, a.asset_name, a.asset_type_name].some((x) => (x ?? "").toLowerCase().includes(q)));
  }, [data, query]);

  return (
    <Screen bg={colors.white}>
      <Header title="Inspection Overview" back />
      <SearchBox value={query} onChange={setQuery} placeholder="Search Location, Asset, or Asset Type" />
      <View style={{ flex: 1 }}>
        <FlatList
          data={rows}
          keyExtractor={(a) => a.id}
          contentContainerStyle={{ paddingBottom: 96 }}
          ListEmptyComponent={<Empty>No Inspections Have Been Taken Today</Empty>}
          renderItem={({ item: a }) => (
            <Row onPress={() => router.push({ pathname: "/inspections/capture", params: { activity: a.id } })}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name="location" size={16} color={colors.ink} />
                <Text style={{ fontSize: 16, fontWeight: "600", color: colors.muted, textTransform: "uppercase" }}>{a.location_name}</Text>
              </View>
              <Text style={{ marginTop: 4, fontSize: 20, fontWeight: "600", color: colors.ink }}>{a.asset_name}</Text>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Text style={{ fontSize: 17, color: "#3b4150" }}>{a.asset_type_name}</Text>
                <Text style={{ fontSize: 17, color: "#3b4150" }}>{shortDateTime(a.inspection_date, timeZone)}</Text>
              </View>
              {a.grading_name && (
                <View style={{ marginTop: 6 }}>
                  <GradingPill name={a.grading_name} hex={a.hex} />
                </View>
              )}
            </Row>
          )}
        />
        {!captureBlocked && <NewButton onPress={() => router.push("/inspections/locations")} />}
      </View>
      <HomeBar />
    </Screen>
  );
}
