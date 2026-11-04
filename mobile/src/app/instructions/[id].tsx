// Instruction view (web/src/app/m/instructions/[uid]/page.tsx): its assets,
// not done first, then location, then asset name. Inspect opens the capture
// form with the instruction; Done rows don't open.
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@powersync/react-native";
import { router, useLocalSearchParams } from "expo-router";
import { FlatList, Text, View } from "react-native";
import { shortDate } from "../../domain/dates";
import { useApp } from "../../state/app-context";
import { Empty, Header, HomeBar, Row, Screen } from "../../ui/components";
import { colors } from "../../ui/theme";

type AllocationRow = {
  id: string;
  asset_id: string;
  is_completed: number;
  asset_name: string | null;
  location_name: string | null;
  asset_type_name: string | null;
};

export default function InstructionView() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { timeZone, captureBlocked } = useApp();
  const { data: instr } = useQuery<{
    name: string;
    comment: string | null;
    required_completed_date: string | null;
    nr_completed: number | null;
    nr_of_allocations: number | null;
  }>("SELECT name, comment, required_completed_date, nr_completed, nr_of_allocations FROM instruction WHERE id = ?", [id]);
  const { data: allocations } = useQuery<AllocationRow>(
    `SELECT x.id, x.asset_id, x.is_completed, a.name AS asset_name, l.name AS location_name, t.name AS asset_type_name
       FROM instruction_asset_allocation x
       LEFT JOIN asset a ON a.id = x.asset_id
       LEFT JOIN location l ON l.id = a.location_id
       LEFT JOIN asset_type t ON t.id = a.asset_type_id
      WHERE x.instruction_id = ?
      ORDER BY x.is_completed, l.name COLLATE NOCASE, a.name COLLATE NOCASE`,
    [id],
  );
  const i = instr[0];

  return (
    <Screen>
      <Header title="Instruction" back />
      {!i ? (
        <Empty icon="clipboard-outline">This instruction is no longer open.</Empty>
      ) : (
        <FlatList
          data={allocations}
          keyExtractor={(a) => a.id}
          ListHeaderComponent={
            <View style={{ backgroundColor: colors.white, padding: 16, marginBottom: 8 }}>
              <Text style={{ fontSize: 22, fontWeight: "600", color: colors.ink }}>{i.name}</Text>
              {!!i.comment && <Text style={{ marginTop: 4, fontSize: 18, color: colors.ink }}>{i.comment}</Text>}
              <Text style={{ marginTop: 8, fontSize: 17, color: colors.muted }}>
                Due {shortDate(i.required_completed_date, timeZone)} · {i.nr_completed ?? 0} / {i.nr_of_allocations ?? 0} done
              </Text>
            </View>
          }
          renderItem={({ item: a }) => {
            const done = a.is_completed === 1;
            return (
              <Row
                style={{ flexDirection: "row", alignItems: "center", gap: 12, opacity: done ? 0.7 : 1 }}
                onPress={
                  done || captureBlocked
                    ? undefined
                    : () => router.push({ pathname: "/inspections/capture", params: { asset: a.asset_id, instruction: id } })
                }
              >
                <Ionicons name="location" size={20} color={colors.ink} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: "600", color: colors.muted, textTransform: "uppercase" }}>{a.location_name}</Text>
                  <Text numberOfLines={1} style={{ fontSize: 20, color: colors.ink }}>
                    {a.asset_name}
                  </Text>
                  <Text style={{ fontSize: 16, color: colors.muted }}>{a.asset_type_name}</Text>
                </View>
                <View style={{ borderRadius: 6, paddingHorizontal: 12, paddingVertical: 4, backgroundColor: done ? colors.done : colors.blue }}>
                  <Text style={{ color: colors.white, fontSize: 16, fontWeight: "600" }}>{done ? "Done" : "Inspect"}</Text>
                </View>
              </Row>
            );
          }}
        />
      )}
      <HomeBar />
    </Screen>
  );
}
