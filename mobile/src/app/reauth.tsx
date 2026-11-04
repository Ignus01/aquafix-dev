// Signing in again after the session couldn't be refreshed. Same account
// only; queued work then uploads.
import { usePowerSync } from "@powersync/react-native";
import { router } from "expo-router";
import { useApp } from "../state/app-context";
import { SignIn } from "../state/sign-in";
import { refreshTimeZone, startSync } from "../sync/sync-manager";

export default function Reauth() {
  const db = usePowerSync();
  const { user, toast } = useApp();
  return (
    <SignIn
      existing={user}
      onCancel={() => router.back()}
      onSignedIn={(u) => {
        void refreshTimeZone().catch(() => undefined);
        void startSync(db, u.id).catch(() => undefined);
        toast("Signed in");
        router.back();
      }}
    />
  );
}
