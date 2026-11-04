import "@azure/core-asynciterator-polyfill";
import { type CommonPowerSyncDatabase, PowerSyncContext } from "@powersync/react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { missingConfig } from "../config";
import { openDatabase } from "../db/database";
import { initSentry, wrapRoot } from "../lib/sentry";
import { getPhoneUser, type PhoneUser } from "../lib/supabase";
import { AppProvider } from "../state/app-context";
import { SignIn } from "../state/sign-in";
import { onSignedOut, refreshTimeZone, startSync } from "../sync/sync-manager";
import { colors } from "../ui/theme";

initSentry();

type Phase = { kind: "loading" } | { kind: "config"; missing: string[] } | { kind: "error"; message: string } | { kind: "ready" };

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: colors.page }}>{children}</View>;
}

function Root() {
  const [phase, setPhase] = useState<Phase>(() => {
    const missing = missingConfig();
    return missing.length > 0 ? { kind: "config", missing } : { kind: "loading" };
  });
  const [db, setDb] = useState<CommonPowerSyncDatabase | null>(null);
  const [user, setUser] = useState<PhoneUser | null>(null);

  useEffect(() => onSignedOut(() => setUser(null)), []);

  useEffect(() => {
    if (missingConfig().length > 0) return;
    (async () => {
      try {
        const database = await openDatabase();
        const owner = await getPhoneUser();
        setDb(database);
        setUser(owner);
        setPhase({ kind: "ready" });
        // Opens offline: sync starts and retries in the background.
        if (owner) void startSync(database, owner.id).catch(() => undefined);
      } catch (e) {
        setPhase({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      }
    })();
  }, []);

  const signedIn = useCallback(
    (u: PhoneUser) => {
      setUser(u);
      if (db) {
        void refreshTimeZone().catch(() => undefined);
        void startSync(db, u.id).catch(() => undefined);
      }
    },
    [db],
  );

  if (phase.kind === "loading") {
    return (
      <Centered>
        <ActivityIndicator color={colors.brand} />
      </Centered>
    );
  }
  if (phase.kind === "config") {
    return (
      <Centered>
        <Text style={{ fontSize: 18, textAlign: "center" }}>This build is missing its configuration: {phase.missing.join(", ")}. See mobile/.env.example.</Text>
      </Centered>
    );
  }
  if (phase.kind === "error" || !db) {
    return (
      <Centered>
        <Text style={{ fontSize: 18, textAlign: "center" }}>{`The local database couldn't be opened. ${phase.kind === "error" ? phase.message : ""}`}</Text>
      </Centered>
    );
  }

  return (
    <PowerSyncContext.Provider value={db}>
      {user ? (
        <AppProvider user={user}>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.page } }} />
        </AppProvider>
      ) : (
        <SignIn existing={null} onSignedIn={signedIn} />
      )}
    </PowerSyncContext.Provider>
  );
}

function Layout() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Root />
    </SafeAreaProvider>
  );
}

export default wrapRoot(Layout);
