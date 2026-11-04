// Shared building blocks copied from the PWA's web/src/app/m/ui.tsx and
// components.tsx: header bar, search box, confirm dialog, sheets, footer,
// pills and empty states.
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { type ReactNode, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, STATUS_COLOURS, STATUS_LABELS } from "./theme";

// The blue title bar. `brand` shows the Aquafix mark (home screens); other
// screens get a back arrow.
export function Header({ title, back, brand, right }: { title: string; back?: boolean | (() => void); brand?: boolean; right?: ReactNode }) {
  const insets = useSafeAreaInsets();
  const onBack = typeof back === "function" ? back : () => (router.canGoBack() ? router.back() : router.replace("/"));
  return (
    <View style={[s.header, { paddingTop: insets.top }]}>
      <View style={s.headerSide}>
        {brand ? (
          <Text style={s.brand}>Aquafix</Text>
        ) : back ? (
          <Pressable onPress={onBack} accessibilityLabel="Back" hitSlop={12} style={s.backBtn}>
            <Ionicons name="chevron-back" size={26} color={colors.white} />
          </Pressable>
        ) : null}
      </View>
      <Text style={s.headerTitle} numberOfLines={1}>
        {title}
      </Text>
      <View style={[s.headerSide, { alignItems: "flex-end" }]}>{right}</View>
    </View>
  );
}

// The bottom Home bar every /m page has.
export function HomeBar() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.homeBar, { paddingBottom: Math.max(insets.bottom, 6) }]}>
      <Pressable onPress={() => router.dismissTo("/")} style={({ pressed }) => [s.homeBtn, pressed && { backgroundColor: colors.pressed }]}>
        <Ionicons name="home" size={26} color={colors.brand} />
        <Text style={s.homeText}>Home</Text>
      </Pressable>
    </View>
  );
}

export function Screen({ children, bg = colors.page }: { children: ReactNode; bg?: string }) {
  return (
    <SafeAreaView edges={["left", "right"]} style={{ flex: 1, backgroundColor: bg }}>
      {children}
    </SafeAreaView>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <View style={s.search}>
      <Ionicons name="search" size={20} color={colors.muted} style={{ marginHorizontal: 16 }} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.subtle}
        style={s.searchInput}
        autoCorrect={false}
        clearButtonMode="while-editing"
        returnKeyType="search"
      />
    </View>
  );
}

export function Empty({ icon = "ban", children }: { icon?: keyof typeof Ionicons.glyphMap; children: ReactNode }) {
  return (
    <View style={s.empty}>
      <View style={s.emptyIcon}>
        <Ionicons name={icon} size={24} color={colors.brand} />
      </View>
      <Text style={s.emptyText}>{children}</Text>
    </View>
  );
}

export function Loading() {
  return (
    <View style={{ padding: 40, alignItems: "center" }}>
      <ActivityIndicator color={colors.brand} />
    </View>
  );
}

type BtnKind = "green" | "dark" | "light";
export function Button({
  title,
  onPress,
  kind = "green",
  disabled,
  style,
  icon,
}: {
  title: string;
  onPress: () => void;
  kind?: BtnKind;
  disabled?: boolean;
  style?: ViewStyle;
  icon?: keyof typeof Ionicons.glyphMap;
}) {
  const bg = kind === "green" ? colors.green : kind === "dark" ? colors.ink : colors.white;
  const fg = kind === "light" ? colors.ink : colors.white;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.btn,
        { backgroundColor: bg, opacity: disabled ? 0.6 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] },
        kind === "light" && { borderWidth: 1, borderColor: colors.border },
        style,
      ]}
    >
      {icon && <Ionicons name={icon} size={18} color={fg} style={{ marginRight: 6 }} />}
      <Text style={[s.btnText, { color: fg, fontWeight: kind === "light" ? "500" : "600" }]}>{title}</Text>
    </Pressable>
  );
}

// The green floating New button.
export function NewButton({ onPress, disabled }: { onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [s.fab, { opacity: disabled ? 0.5 : 1, transform: [{ scale: pressed ? 0.95 : 1 }] }]}
      accessibilityLabel="New"
    >
      <Ionicons name="add" size={22} color={colors.white} />
      <Text style={s.fabText}>New</Text>
    </Pressable>
  );
}

// Fixed Cancel / Save bar above the Home bar.
export function FormFooter({ children }: { children: ReactNode }) {
  return <View style={s.footer}>{children}</View>;
}

export function ErrorLine({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <Text style={s.error}>{children}</Text>;
}

export function ErrorBox({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return <Text style={s.errorBox}>{children}</Text>;
}

export function Label({ children, style }: { children: ReactNode; style?: object }) {
  return <Text style={[s.label, style]}>{children}</Text>;
}

export function Input(props: TextInputProps & { invalid?: boolean }) {
  const { style, invalid, editable, ...rest } = props;
  return (
    <TextInput
      placeholderTextColor={colors.subtle}
      editable={editable}
      {...rest}
      style={[s.input, editable === false && s.inputDisabled, invalid && { borderColor: colors.red }, props.multiline && s.textarea, style]}
    />
  );
}

export function StatusPill({ status }: { status: string }) {
  return (
    <View style={[s.pill, { backgroundColor: STATUS_COLOURS[status] ?? colors.grey }]}>
      <Text style={s.pillText}>{STATUS_LABELS[status] ?? status}</Text>
    </View>
  );
}

export function GradingPill({ name, hex, small }: { name: string; hex: string | null; small?: boolean }) {
  return (
    <View style={[s.grading, { backgroundColor: hex ?? colors.grey }, small && { paddingHorizontal: 8, paddingVertical: 3 }]}>
      <Text style={[s.gradingText, small && { fontSize: 13 }]}>{name}</Text>
    </View>
  );
}

export function Badge({ count }: { count: number }) {
  if (!count) return null;
  return (
    <View style={s.badge}>
      <Text style={s.badgeText}>{count}</Text>
    </View>
  );
}

// "Are you sure?" with Proceed / Cancel — the PWA's Confirmation dialog.
export function ConfirmDialog({
  open,
  title = "Confirmation",
  message = "Are you sure?",
  proceedLabel = "Proceed",
  onProceed,
  onCancel,
}: {
  open: boolean;
  title?: string;
  message?: string;
  proceedLabel?: string;
  onProceed: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={s.dialogBackdrop}>
        <View style={s.dialog}>
          <View style={s.dialogHead}>
            <Text style={s.dialogTitle}>{title}</Text>
            <Pressable onPress={onCancel} accessibilityLabel="Close" hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.ink} />
            </Pressable>
          </View>
          <Text style={s.dialogMessage}>{message}</Text>
          <View style={{ flexDirection: "row", gap: 12, padding: 20, paddingTop: 0 }}>
            <Pressable onPress={onProceed} style={s.dialogProceed}>
              <Text style={{ color: colors.white, fontSize: 17 }}>{proceedLabel}</Text>
            </Pressable>
            <Pressable onPress={onCancel} style={s.dialogCancel}>
              <Text style={{ color: colors.ink, fontSize: 17 }}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// A full-screen sheet over the page (photos, pick lists, popups).
export function Sheet({
  open,
  title,
  onClose,
  footer,
  children,
  scroll = true,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
  scroll?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "#f8f8f8" }}>
        <View style={[s.sheetHead, { paddingTop: insets.top }]}>
          <Text style={s.headerTitle}>{title}</Text>
        </View>
        {scroll ? (
          <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        ) : (
          <View style={{ flex: 1 }}>{children}</View>
        )}
        <View style={[s.sheetFoot, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          {footer ?? <Button title="Close" kind="light" onPress={onClose} style={{ flex: 1 }} />}
        </View>
      </View>
    </Modal>
  );
}

// A select input: shows the chosen label, opens a pick list.
export function SelectField({
  value,
  options,
  onChange,
  placeholder = "Select…",
  disabled,
  invalid,
  title,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const chosen = options.find((o) => o.value === value);
  const q = query.trim().toLowerCase();
  const rows = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  return (
    <>
      <Pressable
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[s.input, s.select, disabled && s.inputDisabled, invalid && { borderColor: colors.red }]}
      >
        <Text style={{ flex: 1, fontSize: 17, color: chosen ? colors.ink : colors.subtle }} numberOfLines={1}>
          {chosen?.label ?? placeholder}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.muted} />
      </Pressable>
      <Sheet open={open} title={title} onClose={() => setOpen(false)}>
        {options.length > 8 && <SearchBox value={query} onChange={setQuery} placeholder="Search" />}
        <Pressable
          onPress={() => {
            onChange("");
            setOpen(false);
          }}
          style={s.option}
        >
          <Text style={[s.optionText, { color: colors.subtle }]}>{placeholder}</Text>
        </Pressable>
        {rows.map((o) => (
          <Pressable
            key={o.value}
            onPress={() => {
              onChange(o.value);
              setOpen(false);
              setQuery("");
            }}
            style={({ pressed }) => [s.option, pressed && { backgroundColor: colors.pressed }]}
          >
            <Text style={[s.optionText, o.value === value && { fontWeight: "700", color: colors.brand }]}>{o.label}</Text>
          </Pressable>
        ))}
      </Sheet>
    </>
  );
}


export function Row({ children, onPress, style }: { children: ReactNode; onPress?: () => void; style?: ViewStyle }) {
  if (!onPress) return <View style={[s.row, style]}>{children}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.row, pressed && { backgroundColor: colors.pressed }, style]}>
      {children}
    </Pressable>
  );
}

export const s = StyleSheet.create({
  header: {
    backgroundColor: colors.brand,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    minHeight: 56,
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  headerSide: { width: 88, height: 56, justifyContent: "center" },
  backBtn: { width: 40, height: 40, justifyContent: "center" },
  brand: { color: colors.white, fontSize: 22, fontWeight: "600", fontStyle: "italic" },
  headerTitle: { flex: 1, textAlign: "center", color: colors.white, fontSize: 19, fontWeight: "600" },
  homeBar: { borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.white, alignItems: "center", paddingTop: 6 },
  homeBtn: { alignItems: "center", minWidth: 96, paddingHorizontal: 16, paddingVertical: 4, borderRadius: 10 },
  homeText: { fontSize: 14, fontWeight: "600", color: colors.brand },
  search: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    height: 54,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  searchInput: { flex: 1, fontSize: 18, color: colors.ink, paddingRight: 12, height: "100%" },
  empty: { alignItems: "center", paddingHorizontal: 24, paddingVertical: 56, gap: 12 },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.pressed, alignItems: "center", justifyContent: "center" },
  emptyText: { fontSize: 19, fontWeight: "500", color: colors.muted, textAlign: "center" },
  btn: { height: 50, minWidth: 110, borderRadius: 12, paddingHorizontal: 24, alignItems: "center", justifyContent: "center", flexDirection: "row" },
  btnText: { fontSize: 17 },
  fab: {
    position: "absolute",
    right: 16,
    bottom: 20,
    height: 56,
    paddingHorizontal: 24,
    borderRadius: 28,
    backgroundColor: colors.green,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    elevation: 6,
    shadowColor: colors.green,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  fabText: { color: colors.white, fontSize: 19, fontWeight: "600" },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  error: { marginTop: 6, fontSize: 15, color: colors.red },
  errorBox: { marginTop: 12, borderRadius: 8, backgroundColor: colors.redSoft, paddingHorizontal: 12, paddingVertical: 8, fontSize: 16, color: colors.redText },
  label: { marginBottom: 6, fontSize: 16, fontWeight: "600", color: "#2a3350" },
  input: {
    minHeight: 54,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: 16,
    fontSize: 17,
    color: colors.ink,
  },
  inputDisabled: { backgroundColor: colors.disabledBg, color: colors.grey },
  textarea: { minHeight: 110, paddingTop: 12, textAlignVertical: "top" },
  select: { flexDirection: "row", alignItems: "center" },
  pill: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4, alignSelf: "flex-start" },
  pillText: { color: colors.white, fontSize: 15, fontWeight: "600" },
  grading: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 2, alignSelf: "flex-start" },
  gradingText: { color: colors.white, fontSize: 15, fontWeight: "600" },
  badge: {
    position: "absolute",
    top: -8,
    right: -20,
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  badgeText: { color: colors.white, fontSize: 15, fontWeight: "600" },
  dialogBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 16, paddingTop: "40%", alignItems: "center" },
  dialog: { width: "100%", maxWidth: 440, borderRadius: 10, backgroundColor: colors.white },
  dialogHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", borderBottomWidth: 1, borderBottomColor: "#dfe2e8", paddingHorizontal: 20, paddingVertical: 16 },
  dialogTitle: { fontSize: 20, fontWeight: "700", color: colors.ink },
  dialogMessage: { padding: 20, fontSize: 19, color: colors.ink },
  dialogProceed: { height: 48, borderRadius: 8, backgroundColor: "#000", paddingHorizontal: 24, justifyContent: "center" },
  dialogCancel: { height: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 24, justifyContent: "center" },
  sheetHead: { backgroundColor: colors.brand, minHeight: 56, justifyContent: "center", alignItems: "center" },
  sheetFoot: { flexDirection: "row", gap: 12, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.white, paddingHorizontal: 16, paddingTop: 12 },
  option: { paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.line, backgroundColor: colors.white },
  optionText: { fontSize: 19, color: colors.ink },
  row: { borderBottomWidth: 1, borderBottomColor: colors.line, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: colors.white },
});
