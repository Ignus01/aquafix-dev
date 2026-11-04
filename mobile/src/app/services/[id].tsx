// Read-only service card (web/src/app/m/services/[reference]/page.tsx).
// Completing a service is done in the back office.
import { useQuery } from "@powersync/react-native";
import { useLocalSearchParams } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { shortDate } from "../../domain/dates";
import { SERVICE_TYPE_LABELS } from "../../queries";
import { useApp } from "../../state/app-context";
import { Empty, Header, HomeBar, Screen } from "../../ui/components";
import { colors } from "../../ui/theme";

const money = (n: number | null) =>
  `R ${(n ?? 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ServiceCard() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { timeZone } = useApp();
  const { data } = useQuery<{
    reference: number | null;
    service_type: string;
    due_date: string | null;
    is_completed: number;
    completed_date: string | null;
    invoice_nr: string | null;
    total_part_cost: number | null;
    total_labour_cost: number | null;
    total_cost: number | null;
    comment: string | null;
    asset_name: string | null;
    asset_code: string | null;
    supplier_name: string | null;
  }>(
    `SELECT s.*, a.name AS asset_name, a.code AS asset_code, o.name AS supplier_name
       FROM service s LEFT JOIN asset a ON a.id = s.asset_id LEFT JOIN organisation o ON o.id = s.supplier_id
      WHERE s.id = ?`,
    [id],
  );
  const s = data[0];
  if (!s) {
    return (
      <Screen>
        <Header title="Service" back />
        <Empty>This service is no longer open.</Empty>
        <HomeBar />
      </Screen>
    );
  }
  const rows: [string, string][] = [
    ["Asset", `${s.asset_name ?? ""} (${s.asset_code ?? ""})`],
    ["Type", SERVICE_TYPE_LABELS[s.service_type] ?? s.service_type],
    ["Due", shortDate(s.due_date, timeZone)],
    ["Status", s.is_completed ? `Completed ${shortDate(s.completed_date, timeZone)}` : "Open"],
    ["Supplier", s.supplier_name ?? "—"],
    ["Invoice", s.invoice_nr ?? "—"],
    ["Parts", money(s.total_part_cost)],
    ["Labour", money(s.total_labour_cost)],
    ["Total", money(s.total_cost)],
  ];
  return (
    <Screen>
      <Header title={`Service ${s.reference ?? ""}`.trim()} back />
      <ScrollView>
        <View style={{ backgroundColor: colors.white, padding: 16, gap: 8 }}>
          {rows.map(([k, v]) => (
            <View key={k} style={{ flexDirection: "row", gap: 12 }}>
              <Text style={{ width: 110, fontSize: 19, fontWeight: "600", color: colors.ink }}>{k}</Text>
              <Text style={{ flex: 1, fontSize: 19, color: colors.ink }}>{v}</Text>
            </View>
          ))}
        </View>
        {!!s.comment && (
          <View style={{ marginTop: 8, backgroundColor: colors.white, padding: 16 }}>
            <Text style={{ marginBottom: 4, fontSize: 16, fontWeight: "600", color: colors.muted, letterSpacing: 1 }}>COMMENT</Text>
            <Text style={{ fontSize: 19, color: colors.ink }}>{s.comment}</Text>
          </View>
        )}
      </ScrollView>
      <HomeBar />
    </Screen>
  );
}
