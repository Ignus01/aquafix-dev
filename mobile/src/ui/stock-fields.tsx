// Stock document inputs (the PWA's doc-form FieldInput) and the pick lists
// they read from the local database.
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@powersync/react-native";
import { Pressable, Text, View } from "react-native";
import { type Field, type OptionsKey, TRANSFER_TYPE_LABELS } from "../commands/stock";
import { DateTimeField } from "./date-field";
import { ErrorLine, Input, Label, SelectField } from "./components";
import { colors } from "./theme";

export type Options = Record<OptionsKey, { value: string; label: string }[]>;

// Forms offer active storage areas and items; lists and views name any.
export function useStockOptions(activeOnly: boolean): Options {
  const where = activeOnly ? "WHERE active = 1" : "";
  const { data: areas } = useQuery<{ id: string; name: string; code: string | null }>(
    `SELECT id, name, code FROM storage_area ${where} ORDER BY name COLLATE NOCASE`,
  );
  const { data: items } = useQuery<{ id: string; name: string; code: string | null }>(`SELECT id, name, code FROM item ${where} ORDER BY name COLLATE NOCASE`);
  return {
    storageAreas: areas.map((a) => ({ value: a.id, label: a.code ? `${a.name} (${a.code})` : a.name })),
    items: items.map((i) => ({ value: i.id, label: i.code ? `${i.name} — ${i.code}` : i.name })),
    transferTypes: Object.entries(TRANSFER_TYPE_LABELS).map(([value, label]) => ({ value, label })),
  };
}

export function FieldInput({
  field,
  value,
  options,
  error,
  onChange,
  timeZone,
}: {
  field: Field;
  value: string;
  options: Options;
  error?: string;
  onChange: (v: string) => void;
  timeZone: string;
}) {
  return (
    <View style={{ marginTop: 16 }}>
      {field.type !== "bool" && <Label>{field.label}</Label>}
      {field.type === "textarea" ? (
        <Input multiline value={value} onChangeText={onChange} invalid={!!error} />
      ) : field.type === "select" ? (
        <SelectField title={field.label} value={value} options={options[field.options!]} onChange={onChange} invalid={!!error} />
      ) : field.type === "bool" ? (
        <Pressable onPress={() => onChange(value === "true" ? "false" : "true")} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Ionicons name={value === "true" ? "checkbox" : "square-outline"} size={26} color={value === "true" ? colors.brand : colors.muted} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 19, color: colors.ink }}>{field.label}</Text>
            {field.hint && <Text style={{ fontSize: 14, color: colors.muted }}>{field.hint}</Text>}
          </View>
        </Pressable>
      ) : field.type === "date" || field.type === "datetime" ? (
        <DateTimeField value={value} onChange={onChange} timeZone={timeZone} mode={field.type} invalid={!!error} />
      ) : (
        <Input
          value={value}
          keyboardType={field.type === "number" ? "decimal-pad" : "default"}
          onChangeText={(t) => onChange(field.type === "number" ? t.replace(",", ".") : t)}
          invalid={!!error}
        />
      )}
      <ErrorLine>{error}</ErrorLine>
    </View>
  );
}
