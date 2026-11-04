// A date or date-and-time input read and written as wall time in the app's
// time zone (not the phone's), like the PWA's datetime-local inputs.
import RNDateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Modal, Platform, Pressable, Text, View } from "react-native";
import { isoToZonedInput, nowIso, todayInZone, zonedInputToIso } from "../domain/dates";
import { Button, s } from "./components";
import { colors } from "./theme";

const pad = (n: number) => String(n).padStart(2, "0");

// "YYYY-MM-DDTHH:mm" wall time → a Date whose device-local fields show it.
function wallToDevice(wall: string): Date {
  const [d, t = "00:00"] = wall.split("T");
  const [y, m, day] = d.split("-").map(Number);
  const [h, mi] = t.split(":").map(Number);
  return new Date(y, m - 1, day, h, mi);
}

function deviceToWall(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function show(value: string, mode: "date" | "datetime"): string {
  if (!value) return "";
  const [d, t] = value.split("T");
  const [y, m, day] = d.split("-");
  return mode === "date" ? `${day}/${m}/${y}` : `${day}/${m}/${y} ${t}`;
}

export function DateTimeField({
  value,
  onChange,
  timeZone,
  mode = "datetime",
  disabled,
  invalid,
}: {
  // ISO timestamp (datetime) or YYYY-MM-DD (date); "" when empty.
  value: string;
  onChange: (v: string) => void;
  timeZone: string;
  mode?: "date" | "datetime";
  disabled?: boolean;
  invalid?: boolean;
}) {
  const wall = mode === "date" ? (value ? `${value}T00:00` : "") : isoToZonedInput(value, timeZone);
  const initial = wall || (mode === "date" ? `${todayInZone(timeZone)}T00:00` : isoToZonedInput(nowIso(), timeZone));
  const [iosOpen, setIosOpen] = useState(false);
  const [draft, setDraft] = useState<Date>(wallToDevice(initial));

  function commit(date: Date) {
    const w = deviceToWall(date);
    onChange(mode === "date" ? w.slice(0, 10) : zonedInputToIso(w, timeZone));
  }

  function open() {
    const start = wallToDevice(initial);
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value: start,
        mode: "date",
        onValueChange: (_e, date) => {
          if (mode === "date") {
            commit(date);
            return;
          }
          DateTimePickerAndroid.open({
            value: date,
            mode: "time",
            is24Hour: true,
            onValueChange: (_e2, time) => {
              const merged = new Date(date);
              merged.setHours(time.getHours(), time.getMinutes(), 0, 0);
              commit(merged);
            },
          });
        },
      });
    } else {
      setDraft(start);
      setIosOpen(true);
    }
  }

  return (
    <>
      <Pressable disabled={disabled} onPress={open} style={[s.input, s.select, disabled && s.inputDisabled, invalid && { borderColor: colors.red }]}>
        <Text style={{ flex: 1, fontSize: 17, color: wall ? colors.ink : colors.subtle }}>{wall ? show(wall, mode) : "Select…"}</Text>
        {value && !disabled ? (
          <Pressable onPress={() => onChange("")} hitSlop={10} accessibilityLabel="Clear">
            <Ionicons name="close-circle" size={20} color={colors.muted} />
          </Pressable>
        ) : (
          <Ionicons name="calendar-outline" size={20} color={colors.muted} />
        )}
      </Pressable>
      {Platform.OS === "ios" && (
        <Modal visible={iosOpen} transparent animationType="fade" onRequestClose={() => setIosOpen(false)}>
          <View style={s.dialogBackdrop}>
            <View style={[s.dialog, { padding: 16 }]}>
              <RNDateTimePicker
                value={draft}
                mode={mode === "date" ? "date" : "datetime"}
                display="inline"
                onValueChange={(_e, d) => setDraft(d)}
              />
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 12 }}>
                <Button title="Cancel" kind="light" onPress={() => setIosOpen(false)} />
                <Button
                  title="Done"
                  onPress={() => {
                    commit(draft);
                    setIosOpen(false);
                  }}
                />
              </View>
            </View>
          </View>
        </Modal>
      )}
    </>
  );
}
