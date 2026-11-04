// Sign-in with the same Supabase accounts as the web app. The first sign-in
// needs a connection; after that the app opens and captures offline. Each
// phone belongs to one inspector: signing in again (when the session can't be
// refreshed) must be the same account.
import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { clearNeedsSignInFlag, type PhoneUser, setPhoneUser, supabase } from "../lib/supabase";
import { APP_VERSION } from "../config";
import { Button, ErrorBox, Header, Input, Label } from "../ui/components";
import { colors } from "../ui/theme";

export function SignIn({
  existing,
  onSignedIn,
  onCancel,
}: {
  existing: PhoneUser | null;
  onSignedIn: (user: PhoneUser) => void;
  onCancel?: () => void;
}) {
  const [email, setEmail] = useState(existing?.email ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    try {
      const { data, error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (authError || !data.user) {
        setError(
          authError && /fetch|network/i.test(authError.message)
            ? "No connection. The first sign-in needs signal."
            : (authError?.message ?? "Sign-in failed."),
        );
        return;
      }
      if (existing && existing.id !== data.user.id) {
        await supabase.auth.signOut({ scope: "local" });
        setError(`This phone holds ${existing.email}'s work. Sign in as ${existing.email}, or sign out first.`);
        return;
      }
      const user = { id: data.user.id, email: data.user.email ?? email.trim() };
      await setPhoneUser(user);
      clearNeedsSignInFlag();
      onSignedIn(user);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <Header title={existing ? "Sign in again" : "Sign in"} brand={!onCancel} back={onCancel} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
          <Text style={{ fontSize: 22, fontWeight: "600", color: colors.ink, textAlign: "center", marginTop: 16 }}>AquaFix Capture</Text>
          {existing && (
            <Text style={{ fontSize: 16, color: colors.muted, textAlign: "center" }}>
              Your session has expired. Sign in again to upload your saved work. Nothing on the phone is lost.
            </Text>
          )}
          <ErrorBox>{error}</ErrorBox>
          <View>
            <Label>Email</Label>
            <Input
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              editable={!existing}
            />
          </View>
          <View>
            <Label>Password</Label>
            <Input value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" onSubmitEditing={submit} />
          </View>
          <Button title={busy ? "Signing in…" : "Sign in"} onPress={submit} disabled={busy} />
          <Text style={{ textAlign: "center", color: colors.subtle, marginTop: 24 }}>Version {APP_VERSION}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
