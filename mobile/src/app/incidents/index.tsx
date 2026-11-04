// Incidents (web/src/app/m/incidents/incident-list.tsx): every open
// incident plus mine completed in the last 7 days, "Only my incidents"
// (on by default for non-admin writers), search on location / type / comment.
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@powersync/react-native";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { dayOf, sevenDayWindowStart, shortDateTime } from "../../domain/dates";
import { isIncidentAdmin, isIncidentWriter } from "../../domain/permissions";
import { useApp } from "../../state/app-context";
import { Empty, Header, HomeBar, NewButton, Row, Screen, SearchBox, StatusPill } from "../../ui/components";
import { colors } from "../../ui/theme";

type IncidentRow = {
  id: string;
  reference: number | null;
  incident_date: string;
  status: string;
  completed_at: string | null;
  comment: string;
  created_by: string | null;
  location_name: string | null;
  type_name: string | null;
  created_by_name: string | null;
};

const INCIDENT_LIST_SQL = `
  SELECT i.id, i.reference, i.incident_date, i.status, i.completed_at, coalesce(i.comment, '') AS comment, i.created_by,
         l.name AS location_name, t.name AS type_name, p.username AS created_by_name
    FROM incident i
    LEFT JOIN location l ON l.id = i.location_id
    LEFT JOIN incident_type t ON t.id = i.incident_type_id
    LEFT JOIN profiles p ON p.id = i.created_by
   ORDER BY julianday(i.incident_date) DESC`;

export default function Incidents() {
  const { user, roles, timeZone, captureBlocked } = useApp();
  const { data } = useQuery<IncidentRow>(INCIDENT_LIST_SQL);
  const [query, setQuery] = useState("");
  const [mine, setMine] = useState(!isIncidentAdmin(roles) && isIncidentWriter(roles));
  const windowStart = sevenDayWindowStart(timeZone);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.filter((i) => {
      if (i.status === "completed") {
        if (i.created_by !== user.id) return false;
        if (!i.completed_at || dayOf(i.completed_at, timeZone) < windowStart) return false;
      }
      if (mine && i.created_by !== user.id) return false;
      if (!q) return true;
      return [i.location_name, i.type_name, i.comment].some((s) => (s ?? "").toLowerCase().includes(q));
    });
  }, [data, query, mine, user.id, timeZone, windowStart]);

  return (
    <Screen>
      <Header title="Incidents" back />
      <SearchBox value={query} onChange={setQuery} placeholder="Search Location, Incident Type or Comment" />
      <Pressable onPress={() => setMine((m) => !m)} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 8 }}>
        <Ionicons name={mine ? "checkbox" : "square-outline"} size={24} color={mine ? colors.brand : colors.muted} />
        <Text style={{ fontSize: 17, color: colors.ink }}>Only my incidents</Text>
      </Pressable>
      <View style={{ flex: 1 }}>
        <FlatList
          data={rows}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ paddingBottom: 96 }}
          ListEmptyComponent={<Empty>No incidents</Empty>}
          renderItem={({ item: i }) => (
            <Row onPress={() => router.push({ pathname: "/incidents/[id]", params: { id: i.id } })}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                <View style={{ flex: 1, gap: 8 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <Ionicons name="document-text-outline" size={20} color={colors.ink} />
                    <Text numberOfLines={1} style={{ fontSize: 21, color: colors.ink, flex: 1 }}>
                      {i.type_name}
                    </Text>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                    <Ionicons name="person-outline" size={20} color={colors.ink} />
                    <Text numberOfLines={1} style={{ fontSize: 21, color: colors.ink, flex: 1 }}>
                      {i.created_by_name ?? "—"}
                    </Text>
                  </View>
                </View>
                <View style={{ alignItems: "flex-end", gap: 6 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={{ fontSize: 18, color: colors.ink }}>{shortDateTime(i.incident_date, timeZone)}</Text>
                    <Ionicons name="time-outline" size={18} color={colors.ink} />
                  </View>
                  <StatusPill status={i.status} />
                </View>
              </View>
              <Text style={{ marginTop: 4, fontSize: 16, fontWeight: "600", color: colors.muted, textTransform: "uppercase" }}>{i.location_name}</Text>
              <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
                <Ionicons name="chatbox-outline" size={20} color={colors.ink} style={{ marginTop: 4 }} />
                <Text style={{ fontSize: 20, color: colors.ink, flex: 1 }}>{i.comment}</Text>
              </View>
            </Row>
          )}
        />
        {isIncidentWriter(roles) && !captureBlocked && <NewButton onPress={() => router.push("/incidents/new")} />}
      </View>
      <HomeBar />
    </Screen>
  );
}
