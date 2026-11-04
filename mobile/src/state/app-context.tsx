// What every screen needs: who is signed in, their roles (my_roles stream),
// the app time zone, whether this build may capture (min_app_version), and
// a toast.
import { useQuery } from "@powersync/react-native";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { APP_VERSION } from "../config";
import { DEFAULT_TIME_ZONE } from "../domain/dates";
import { type Role } from "../domain/permissions";
import { isBelowMinimum } from "../domain/version";
import { needsSignIn, onNeedsSignInChange, type PhoneUser } from "../lib/supabase";
import { TIME_ZONE_KEY } from "../sync/sync-manager";
import { colors } from "../ui/theme";

type AppState = {
  user: PhoneUser;
  roles: Role[];
  rolesLoaded: boolean;
  timeZone: string;
  minVersion: string;
  // Below the minimum version: keep uploading, block new captures.
  captureBlocked: boolean;
  needsSignIn: boolean;
  toast: (message: string) => void;
};

const Ctx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp outside AppProvider");
  return v;
}

export function AppProvider({ user, children }: { user: PhoneUser; children: ReactNode }) {
  const { data: roleRows, isLoading } = useQuery<{ role: Role }>("SELECT role FROM user_masterdata_roles WHERE user_id = ?", [user.id]);
  const { data: tzRows } = useQuery<{ value: string }>("SELECT value FROM app_setting WHERE key = ?", [TIME_ZONE_KEY]);
  const { data: cfgRows } = useQuery<{ min_app_version: string | null }>("SELECT min_app_version FROM mobile_app_config LIMIT 1");
  const [reauth, setReauth] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void needsSignIn().then(setReauth);
    return onNeedsSignInChange(setReauth);
  }, []);

  const toast = useCallback((m: string) => {
    setMessage(m);
    setTimeout(() => setMessage(null), 3200);
  }, []);

  const value = useMemo<AppState>(() => {
    const minVersion = cfgRows[0]?.min_app_version ?? "0.0.0";
    return {
      user,
      roles: roleRows.map((r) => r.role),
      rolesLoaded: !isLoading,
      timeZone: tzRows[0]?.value || DEFAULT_TIME_ZONE,
      minVersion,
      captureBlocked: isBelowMinimum(APP_VERSION, minVersion),
      needsSignIn: reauth,
      toast,
    };
  }, [user, roleRows, isLoading, tzRows, cfgRows, reauth, toast]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {message && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 16,
            right: 16,
            bottom: 150,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            borderRadius: 12,
            backgroundColor: colors.ink,
            paddingHorizontal: 16,
            paddingVertical: 12,
          }}
        >
          <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: colors.green, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: colors.white }}>✓</Text>
          </View>
          <Text style={{ color: colors.white, fontSize: 17, fontWeight: "500" }}>{message}</Text>
        </View>
      )}
    </Ctx.Provider>
  );
}
