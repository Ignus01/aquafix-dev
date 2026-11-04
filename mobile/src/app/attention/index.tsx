// Needs attention (new): saves the server rejected, oldest first, with the
// server's messages. Open re-opens the original form; Discard deletes the
// item and its photo files after a confirmation.
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@powersync/react-native";
import { router } from "expo-router";
import { FlatList, Text, View } from "react-native";
import { attentionSummary, type AttentionMessages, COMMAND_LABELS, type CommandName } from "../../commands/types";
import { shortDateTime } from "../../domain/dates";
import { useApp } from "../../state/app-context";
import { Empty, Header, HomeBar, Row, Screen } from "../../ui/components";
import { colors } from "../../ui/theme";

export default function NeedsAttention() {
  const { timeZone } = useApp();
  const { data } = useQuery<{ id: string; command: CommandName; messages: string; failed_at: string }>(
    "SELECT id, command, messages, failed_at FROM needs_attention ORDER BY failed_at",
  );
  return (
    <Screen bg={colors.white}>
      <Header title="Needs attention" back />
      <FlatList
        data={data}
        keyExtractor={(r) => r.id}
        ListEmptyComponent={<Empty icon="checkmark-circle-outline">Nothing needs attention.</Empty>}
        renderItem={({ item }) => {
          const m = JSON.parse(item.messages) as AttentionMessages;
          return (
            <Row
              onPress={() => router.push({ pathname: "/attention/[id]", params: { id: item.id } })}
              style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
            >
              <Ionicons name="alert-circle" size={24} color={colors.orange} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 19, fontWeight: "600", color: colors.ink }}>{COMMAND_LABELS[item.command] ?? item.command}</Text>
                  <Text style={{ fontSize: 15, color: colors.muted }}>{shortDateTime(item.failed_at, timeZone)}</Text>
                </View>
                <Text numberOfLines={2} style={{ fontSize: 16, color: colors.redText }}>
                  {attentionSummary(m)}
                </Text>
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
