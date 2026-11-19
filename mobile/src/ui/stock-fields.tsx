// Stock document inputs (the PWA's doc-form FieldInput) and the pick lists
// they read from the local database.
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@powersync/react-native";
import { Pressable, Text, View } from "react-native";
import { type Field, type OptionsKey, TRANSFER_TYPE_LABELS } from "../commands/stock";
import { DateTimeField } from "./date-field";
import { ErrorLine, Input, Label, SelectField } from "./components";
import { colors } from "./theme";

export type Option = { value: string; label: string; locationId?: string | null; technicianUserId?: string | null };
export type OnHandRow = { item_id: string; storage_area_id: string; qty: number };

// Stock on hand per item and storage area (synced, and moved by each Save).
export function useOnHand(): OnHandRow[] {
  const { data } = useQuery<OnHandRow>("SELECT item_id, storage_area_id, qty FROM storage_area_stock WHERE qty != 0");
  return data;
}

// The signed-in technician's kit, if they have one.
export function useMyKit(userId: string): string | null {
  const { data } = useQuery<{ id: string }>("SELECT id FROM storage_area WHERE technician_user_id = ? AND active = 1", [userId]);
  return data[0]?.id ?? null;
}
export type Options = Record<OptionsKey, Option[]>;

const SERVICE_TYPE_LABELS: Record<string, string> = { scheduled_maintenance: "Scheduled maintenance", repair: "Repair" };

// Forms offer active storage areas and items; lists and views name any.
export function useStockOptions(activeOnly: boolean): Options {
  const where = activeOnly ? "WHERE active = 1" : "";
  const { data: areas } = useQuery<{ id: string; name: string; code: string | null; technician_user_id: string | null }>(
    `SELECT id, name, code, technician_user_id FROM storage_area ${where} ORDER BY name COLLATE NOCASE`,
  );
  const { data: items } = useQuery<{ id: string; name: string; code: string | null }>(`SELECT id, name, code FROM item ${where} ORDER BY name COLLATE NOCASE`);
  const { data: sites } = useQuery<{ id: string; name: string }>(`SELECT id, name FROM location ${where} ORDER BY name COLLATE NOCASE`);
  // Open services and incidents (the only ones the phone has), by site.
  const { data: services } = useQuery<{ id: string; service_type: string; due_date: string; asset_name: string | null; location_id: string | null }>(
    `SELECT s.id, s.service_type, s.due_date, a.name AS asset_name, a.location_id
       FROM service s LEFT JOIN asset a ON a.id = s.asset_id
      WHERE s.is_completed = 0 ORDER BY s.due_date`,
  );
  const { data: incidents } = useQuery<{ id: string; reference: number | null; comment: string | null; location_id: string | null; type_name: string | null }>(
    `SELECT i.id, i.reference, i.comment, i.location_id, t.name AS type_name
       FROM incident i LEFT JOIN incident_type t ON t.id = i.incident_type_id
      WHERE i.status != 'completed' ORDER BY i.incident_date DESC`,
  );
  return {
    storageAreas: areas.map((a) => ({ value: a.id, label: a.code ? `${a.name} (${a.code})` : a.name, technicianUserId: a.technician_user_id })),
    items: items.map((i) => ({ value: i.id, label: i.code ? `${i.name} — ${i.code}` : i.name })),
    transferTypes: Object.entries(TRANSFER_TYPE_LABELS).map(([value, label]) => ({ value, label })),
    sites: sites.map((l) => ({ value: l.id, label: l.name })),
    services: services.map((s) => ({
      value: s.id,
      label: `${s.asset_name ?? "—"} · ${SERVICE_TYPE_LABELS[s.service_type] ?? s.service_type} · due ${String(s.due_date).slice(0, 10)}`,
      locationId: s.location_id,
    })),
    incidents: incidents.map((i) => {
      const comment = i.comment ?? "";
      return {
        value: i.id,
        label: `${i.reference ? `#${i.reference}` : "New"} · ${i.type_name ?? "Incident"} · ${comment.length > 40 ? `${comment.slice(0, 40)}…` : comment}`,
        locationId: i.location_id,
      };
    }),
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
