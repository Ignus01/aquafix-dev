// Config comes from the environment only (mobile/.env, see .env.example).
// EXPO_PUBLIC_* values are inlined into the bundle at build time.
import Constants from "expo-constants";

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
export const POWERSYNC_URL = process.env.EXPO_PUBLIC_POWERSYNC_URL ?? "";
export const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? "";

// APP_ENV is read by app.config.ts at build time and passed through `extra`.
export const APP_ENV: string = (Constants.expoConfig?.extra?.appEnv as string | undefined) ?? "development";

// The semantic version shown on the home screen and compared with
// mobile_app_config.min_app_version.
export const APP_VERSION: string = Constants.expoConfig?.version ?? "0.0.0";

export const INSPECTION_BUCKET = "inspection-images";
export const INCIDENT_BUCKET = "incident-images";

export function missingConfig(): string[] {
  const missing: string[] = [];
  if (!SUPABASE_URL) missing.push("EXPO_PUBLIC_SUPABASE_URL");
  if (!SUPABASE_PUBLISHABLE_KEY) missing.push("EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  if (!POWERSYNC_URL) missing.push("EXPO_PUBLIC_POWERSYNC_URL");
  return missing;
}
