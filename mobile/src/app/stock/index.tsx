// Stock home (web/src/app/m/stock/page.tsx): sub-tiles by role.
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import type { ComponentProps } from "react";
import { Pressable, Text, View } from "react-native";
import { canDoc, type StockKind } from "../../domain/permissions";
import { useApp } from "../../state/app-context";
import { Header, HomeBar, Screen } from "../../ui/components";
import { colors } from "../../ui/theme";

const TILES: { kind: StockKind; label: string; icon: ComponentProps<typeof Ionicons>["name"] }[] = [
  { kind: "loads", label: "Intakes", icon: "document-attach-outline" },
  { kind: "transfers", label: "Transfers", icon: "bus-outline" },
  { kind: "work-orders", label: "Work Order", icon: "list-outline" },
  { kind: "stock-takes", label: "Stock Take", icon: "calculator-outline" },
];

export default function StockHome() {
  const { roles } = useApp();
  const tiles = TILES.filter((t) => canDoc(roles, t.kind, "read"));
  return (
    <Screen>
      <Header title="Stock - Home" back />
      <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 12, padding: 16, alignContent: "flex-start" }}>
        {tiles.map((t) => (
          <Pressable
            key={t.kind}
            onPress={() => router.push({ pathname: "/stock/[kind]", params: { kind: t.kind } })}
            style={({ pressed }) => ({
              width: "48.5%",
              alignItems: "center",
              gap: 8,
              borderRadius: 18,
              backgroundColor: pressed ? colors.pressed : colors.white,
              paddingVertical: 20,
              borderWidth: 1,
              borderColor: colors.line,
            })}
          >
            <Ionicons name={t.icon} size={60} color={colors.ink} />
            <Text style={{ fontSize: 19, fontWeight: "600", color: colors.ink }}>{t.label}</Text>
          </Pressable>
        ))}
        {tiles.length === 0 && (
          <Text style={{ width: "100%", paddingVertical: 32, textAlign: "center", fontSize: 18, color: colors.muted }}>
            No stock functions available for your role.
          </Text>
        )}
      </View>
      <HomeBar />
    </Screen>
  );
}
