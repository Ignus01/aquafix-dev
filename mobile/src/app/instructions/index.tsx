// Instructions (web/src/app/m/instructions/page.tsx): my open instructions
// by due date, overdue in red.
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@powersync/react-native";
import { router } from "expo-router";
import { FlatList, Text, View } from "react-native";
import { dayOf, shortDate, todayInZone } from "../../domain/dates";
import { OPEN_INSTRUCTIONS_SQL } from "../../queries";
import { useApp } from "../../state/app-context";
import { Empty, Header, HomeBar, Row, Screen } from "../../ui/components";
import { colors } from "../../ui/theme";

type InstructionRow = {
  id: string;
  name: string;
  comment: string | null;
  nr_of_allocations: number | null;
  nr_completed: number | null;
  required_completed_date: string | null;
};

export default function Instructions() {
  const { user, timeZone } = useApp();
  const { data } = useQuery<InstructionRow>(OPEN_INSTRUCTIONS_SQL, [user.id]);
  const today = todayInZone(timeZone);

  return (
    <Screen bg={colors.white}>
      <Header title="Instructions" back />
      <FlatList
        data={data}
        keyExtractor={(i) => i.id}
        ListEmptyComponent={<Empty icon="clipboard-outline">No open instructions</Empty>}
        renderItem={({ item: i }) => {
          const overdue = !!i.required_completed_date && dayOf(i.required_completed_date, timeZone) < today;
          return (
            <Row
              onPress={() => router.push({ pathname: "/instructions/[id]", params: { id: i.id } })}
              style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
            >
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ fontSize: 21, fontWeight: "600", color: colors.ink }}>
                  {i.name}
                </Text>
                {!!i.comment && (
                  <Text numberOfLines={1} style={{ fontSize: 17, color: colors.muted }}>
                    {i.comment}
                  </Text>
                )}
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
                  <Text style={{ fontSize: 17, color: overdue ? colors.red : colors.ink, fontWeight: overdue ? "600" : "400" }}>
                    Due {shortDate(i.required_completed_date, timeZone)}
                  </Text>
                  <Text style={{ fontSize: 17, color: colors.ink }}>
                    {i.nr_completed ?? 0} / {i.nr_of_allocations ?? 0} done
                  </Text>
                </View>
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
