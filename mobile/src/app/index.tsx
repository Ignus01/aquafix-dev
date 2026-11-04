// Home (web/src/app/m/page.tsx): the tile grid by role, plus the sync status
// line, the Needs attention row and the version footer.
import { Ionicons } from "@expo/vector-icons";
import { usePowerSync, useQuery, useStatus } from "@powersync/react-native";
import { router } from "expo-router";
import { type ComponentProps, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { APP_VERSION } from "../config";
import { shortDateTime } from "../domain/dates";
import { isInspectionWriter } from "../domain/permissions";
import { OFF_COUNT_SQL, OPEN_INSTRUCTIONS_SQL } from "../queries";
import { useApp } from "../state/app-context";
import { LAST_SYNC_KEY, SignOutBlocked, signOutAndWipe } from "../sync/sync-manager";
import { Badge, ConfirmDialog, Header, Screen } from "../ui/components";
import { colors } from "../ui/theme";

function Tile({ label, icon, badge, onPress }: { label: string; icon: ComponentProps<typeof Ionicons>["name"]; badge?: number; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        width: "48.5%",
        alignItems: "center",
        gap: 8,
        borderRadius: 18,
        backgroundColor: pressed ? colors.pressed : colors.white,
        paddingVertical: 20,
        borderWidth: 1,
        borderColor: colors.line,
        transform: [{ scale: pressed ? 0.97 : 1 }],
      })}
    >
      <View>
        <Ionicons name={icon} size={60} color={colors.ink} />
        <Badge count={badge ?? 0} />
      </View>
      <Text style={{ fontSize: 19, fontWeight: "600", color: colors.ink }}>{label}</Text>
    </Pressable>
  );
}

// Transactions waiting to upload (one per Save).
function useWaiting(): number {
  const db = usePowerSync();
  const status = useStatus();
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    const read = async () => {
      try {
        const row = await db.getOptional<{ n: number }>("SELECT count(DISTINCT tx_id) AS n FROM ps_crud");
        if (live) setN(row?.n ?? 0);
      } catch {
        const stats = await db.getUploadQueueStats();
        if (live) setN(stats.count);
      }
    };
    void read();
    const dispose = db.onChange({ onChange: () => void read() }, { throttleMs: 500 });
    const timer = setInterval(read, 5000);
    return () => {
      live = false;
      dispose();
      clearInterval(timer);
    };
  }, [db, status.uploading, status.lastSyncedAt]);
  return n;
}

export default function Home() {
  const db = usePowerSync();
  const { user, roles, rolesLoaded, timeZone, captureBlocked, needsSignIn } = useApp();
  const status = useStatus();
  const writer = isInspectionWriter(roles);
  const { data: instr } = useQuery(OPEN_INSTRUCTIONS_SQL, [user.id]);
  const { data: off } = useQuery<{ n: number }>(OFF_COUNT_SQL);
  const { data: attention } = useQuery<{ n: number }>("SELECT count(*) AS n FROM needs_attention");
  const { data: lastSync } = useQuery<{ value: string }>("SELECT value FROM app_setting WHERE key = ?", [LAST_SYNC_KEY]);
  const waiting = useWaiting();
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  const last = status.lastSyncedAt?.toISOString() ?? lastSync[0]?.value ?? null;
  const attentionCount = attention[0]?.n ?? 0;
  const noRole = rolesLoaded && status.hasSynced && !roles.some((r) => r !== "viewer");

  async function signOut() {
    setConfirmSignOut(false);
    try {
      await signOutAndWipe(db);
      // The root layout shows sign-in once the owner is cleared.
    } catch (e) {
      Alert.alert("Can't sign out yet", e instanceof SignOutBlocked ? e.message : "Sign-out failed. Try again.");
    }
  }

  return (
    <Screen>
      <Header title="Home" brand />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={{ paddingHorizontal: 16, paddingTop: 10, flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: status.connected ? colors.done : colors.grey }} />
          <Text style={{ fontSize: 15, color: colors.muted, flex: 1 }}>
            {status.connected ? "Online" : "Offline"} · Last synced {last ? shortDateTime(last, timeZone) : "never"}
            {waiting > 0 ? ` · ${waiting} waiting to upload` : ""}
          </Text>
        </View>

        {needsSignIn && (
          <Pressable onPress={() => router.push("/reauth")} style={banner(colors.amber)}>
            <Text style={bannerText}>Your session has expired. Tap to sign in again; saved work waits until you do.</Text>
          </Pressable>
        )}
        {captureBlocked && (
          <View style={banner(colors.red)}>
            <Text style={bannerText}>This version of the app is too old. Update it to capture again. Saved work still uploads.</Text>
          </View>
        )}
        {attentionCount > 0 && (
          <Pressable onPress={() => router.push("/attention")} style={banner(colors.orange)}>
            <Ionicons name="alert-circle" size={22} color={colors.white} />
            <Text style={[bannerText, { flex: 1 }]}>
              {attentionCount} save{attentionCount === 1 ? "" : "s"} need{attentionCount === 1 ? "s" : ""} attention
            </Text>
            <Ionicons name="chevron-forward" size={20} color={colors.white} />
          </Pressable>
        )}
        {noRole && (
          <View style={banner(colors.grey)}>
            <Text style={bannerText}>Your account has no capture role, so nothing syncs to this phone. Ask an admin for access.</Text>
          </View>
        )}
        {!status.hasSynced && (
          <View style={banner(colors.blue)}>
            <Text style={bannerText}>{status.connected ? "Downloading your data…" : "Waiting for signal to download your data."}</Text>
          </View>
        )}

        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 12, paddingHorizontal: 16, paddingTop: 16 }}>
          {writer && <Tile label="Inspections" icon="search" onPress={() => router.push("/inspections")} />}
          <Tile label="Incidents" icon="warning-outline" onPress={() => router.push("/incidents")} />
          {writer && <Tile label="Instructions" icon="clipboard-outline" badge={instr.length} onPress={() => router.push("/instructions")} />}
          <Tile label="Services" icon="construct-outline" onPress={() => router.push("/services")} />
          <Tile label="Location Status" icon="business-outline" badge={off[0]?.n ?? 0} onPress={() => router.push("/location-status")} />
          <Tile label="Stock" icon="cube-outline" onPress={() => router.push("/stock")} />
        </View>

        <View style={{ alignItems: "center", marginTop: 28, gap: 6 }}>
          <Text style={{ color: colors.subtle, fontSize: 14 }}>
            {user.email} · Version {APP_VERSION}
          </Text>
          <Text style={{ color: colors.subtle, fontSize: 14 }}>Last synced {last ? shortDateTime(last, timeZone) : "never"}</Text>
          <Pressable onPress={() => setConfirmSignOut(true)} hitSlop={10}>
            <Text style={{ color: colors.brand, fontSize: 16, fontWeight: "600", marginTop: 8 }}>Sign out</Text>
          </Pressable>
        </View>
      </ScrollView>
      <ConfirmDialog
        open={confirmSignOut}
        title="Sign out"
        message="Signing out removes all data from this phone. Saves that haven't uploaded must finish first."
        proceedLabel="Sign out"
        onProceed={signOut}
        onCancel={() => setConfirmSignOut(false)}
      />
    </Screen>
  );
}

const banner = (bg: string) =>
  ({
    marginHorizontal: 16,
    marginTop: 10,
    borderRadius: 12,
    backgroundColor: bg,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  }) as const;
const bannerText = { color: colors.white, fontSize: 16, fontWeight: "500" } as const;
