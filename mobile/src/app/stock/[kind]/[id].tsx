// Read-only view of a stock document and its lines
// (web/src/app/m/stock/[kind]/[reference]/page.tsx).
import { useQuery } from "@powersync/react-native";
import { useLocalSearchParams } from "expo-router";
import { ScrollView, Text, View } from "react-native";
import { docNumber, type Field, isStockKind, STOCK_CONFIG, TRANSFER_TYPE_LABELS } from "../../../commands/stock";
import { shortDate, shortDateTime } from "../../../domain/dates";
import { useApp } from "../../../state/app-context";
import { Empty, Header, HomeBar, Screen } from "../../../ui/components";
import { useStockOptions } from "../../../ui/stock-fields";
import { colors } from "../../../ui/theme";

type Rec = Record<string, string | number | null>;

export default function StockDoc() {
  const { kind: raw, id } = useLocalSearchParams<{ kind: string; id: string }>();
  const kind = isStockKind(raw) ? raw : "work-orders";
  const cfg = STOCK_CONFIG[kind];
  const { timeZone } = useApp();
  const options = useStockOptions(false);
  const { data: docs } = useQuery<Rec>(`SELECT * FROM ${cfg.table} WHERE id = ?`, [id]);
  const { data: lines } = useQuery<Rec>(cfg.line ? `SELECT * FROM ${cfg.line.table} WHERE ${cfg.line.fk} = ?` : "SELECT 1 WHERE 0", [id]);
  const doc = docs[0];

  function show(f: Field, raw: unknown): string {
    if (raw === null || raw === undefined || raw === "") return "—";
    if (f.key === "transfer_type") return TRANSFER_TYPE_LABELS[String(raw)] ?? String(raw);
    if (f.type === "select") return options[f.options!].find((o) => o.value === raw)?.label ?? String(raw);
    if (f.type === "date") return shortDate(String(raw), timeZone);
    if (f.type === "datetime") return shortDateTime(String(raw), timeZone);
    if (f.type === "bool") return raw === 1 || raw === true ? "Yes" : "No";
    return String(raw);
  }

  if (!doc) {
    return (
      <Screen>
        <Header title={cfg.label} back />
        <Empty>This document is no longer on this phone.</Empty>
        <HomeBar />
      </Screen>
    );
  }
  const textValues = Object.fromEntries(Object.entries(doc).map(([k, v]) => [k, String(v ?? "")]));
  const extra = kind === "stock-takes" ? [{ key: "adjustment_qty", label: "Adjustment", type: "number" as const }] : [];

  return (
    <Screen>
      <Header title={docNumber(kind, doc.reference as number | null)} back />
      <ScrollView>
        <View style={{ backgroundColor: colors.white, padding: 16, gap: 8 }}>
          {cfg.header
            .filter((f) => !f.showWhen || f.showWhen(textValues))
            .map((f) => (
              <View key={f.key} style={{ flexDirection: "row", gap: 12 }}>
                <Text style={{ width: 130, fontSize: 19, fontWeight: "600", color: colors.ink }}>{f.label}</Text>
                <Text style={{ flex: 1, fontSize: 19, color: colors.ink }}>{show(f, doc[f.key])}</Text>
              </View>
            ))}
        </View>
        {cfg.line && (
          <>
            <Text style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4, fontSize: 16, fontWeight: "600", color: colors.muted, letterSpacing: 1 }}>
              {cfg.line.plural.toUpperCase()} ({lines.length})
            </Text>
            <View style={{ backgroundColor: colors.white }}>
              {lines.length === 0 && <Text style={{ padding: 16, fontSize: 17, color: colors.muted }}>No lines.</Text>}
              {lines.map((l) => (
                <View key={String(l.id)} style={{ borderBottomWidth: 1, borderBottomColor: "#dfe2e8", padding: 12, paddingHorizontal: 16 }}>
                  {[...cfg.line!.fields, ...extra].map((f) => (
                    <View key={f.key} style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                      <Text style={{ fontSize: 18, color: colors.muted }}>{f.label}</Text>
                      <Text style={{ fontSize: 18, color: colors.ink, flexShrink: 1, textAlign: "right" }}>
                        {f.key === "adjustment_qty" && l[f.key] === null ? "after sync" : show(f, l[f.key])}
                      </Text>
                    </View>
                  ))}
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
      <HomeBar />
    </Screen>
  );
}
