// Stock on hand (MWTS distribution): what is in my kit, or any other kit or
// store, from the phone's copy of storage_area_stock — offline too.
import { useQuery } from "@powersync/react-native";
import { useState } from "react";
import { FlatList, Text, View } from "react-native";
import { useApp } from "../../state/app-context";
import { Empty, Header, HomeBar, Label, Row, Screen, SelectField } from "../../ui/components";
import { useMyKit, useStockOptions } from "../../ui/stock-fields";
import { colors } from "../../ui/theme";

const plain = (n: number) => String(Number(Number(n).toFixed(3)));

export default function OnHand() {
  const { user } = useApp();
  const options = useStockOptions(false);
  const myKit = useMyKit(user.id);
  const [picked, setPicked] = useState<string | null>(null);
  const area = picked ?? myKit ?? "";
  const { data } = useQuery<{ item_id: string; qty: number; item_name: string | null; item_code: string | null }>(
    `SELECT s.item_id, s.qty, i.name AS item_name, i.code AS item_code
       FROM storage_area_stock s LEFT JOIN item i ON i.id = s.item_id
      WHERE s.storage_area_id = ? AND s.qty != 0
      ORDER BY i.name COLLATE NOCASE`,
    [area],
  );
  const areas = [...options.storageAreas]
    .sort((a, b) => Number(b.value === myKit) - Number(a.value === myKit) || a.label.localeCompare(b.label))
    .map((a) => (a.value === myKit ? { ...a, label: `My kit — ${a.label}` } : a));

  return (
    <Screen bg={colors.white}>
      <Header title="Stock on hand" back />
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <Label>Storage area</Label>
        <SelectField title="Storage area" value={area} options={areas} onChange={setPicked} />
      </View>
      <FlatList
        style={{ flex: 1, marginTop: 8 }}
        data={area ? data : []}
        keyExtractor={(r) => r.item_id}
        ListEmptyComponent={<Empty>{area ? "Nothing in stock here" : "Choose a storage area"}</Empty>}
        renderItem={({ item: r }) => (
          <Row>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 19, fontWeight: "600", color: colors.ink }}>{r.item_name ?? "—"}</Text>
              {r.item_code ? <Text style={{ fontSize: 15, color: colors.muted }}>{r.item_code}</Text> : null}
            </View>
            <Text style={{ fontSize: 21, fontWeight: "600", color: r.qty < 0 ? "#d92d20" : colors.ink }}>{plain(r.qty)}</Text>
          </Row>
        )}
      />
      <HomeBar />
    </Screen>
  );
}
