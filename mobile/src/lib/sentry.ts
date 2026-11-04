// Crash and error reporting. Off until EXPO_PUBLIC_SENTRY_DSN is set. Upload
// rejections and failures are logged with the command name and error code,
// never the payload, so no captured data leaves the phone this way.
import * as Sentry from "@sentry/react-native";
import { APP_ENV, SENTRY_DSN } from "../config";

export const sentryEnabled = !!SENTRY_DSN;

export function initSentry(): void {
  if (!sentryEnabled) return;
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: APP_ENV,
    sendDefaultPii: false,
    // No breadcrumbs of HTTP bodies or console output with captured data.
    maxBreadcrumbs: 20,
    beforeBreadcrumb: (b) => (b.category === "console" ? null : b),
  });
}

export function logUploadProblem(command: string, code: string, kind: "rejected" | "error" | "transient"): void {
  if (!sentryEnabled) return;
  Sentry.captureMessage(`upload ${kind}: ${command} ${code}`, {
    level: kind === "transient" ? "info" : "warning",
    tags: { command, code, kind },
  });
}

export function setSentryUser(id: string | null): void {
  if (!sentryEnabled) return;
  Sentry.setUser(id ? { id } : null);
}

export const wrapRoot = <T,>(component: T): T => (sentryEnabled ? (Sentry.wrap(component as never) as T) : component);
