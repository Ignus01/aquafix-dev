// Dates are formatted in the app's configured time zone (system_settings,
// default Africa/Johannesburg) with a fixed locale, so the server render and
// the browser agree. Same `dd MMM yyyy, HH:mm` shape as the email (EML-R07).

function parts(iso: string, timeZone: string, withTime: boolean) {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } : {}),
  }).formatToParts(new Date(iso));
  return (type: string) => formatted.find((p) => p.type === type)?.value ?? "";
}

export function formatDateTime(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "—";
  const get = parts(iso, timeZone, true);
  return `${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")}`;
}

export function formatDate(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "—";
  const get = parts(iso, timeZone, false);
  return `${get("day")} ${get("month")} ${get("year")}`;
}

// Whether `iso` falls on the same calendar day as `now` in the given time
// zone — for the field user's "open, or logged today" list
// (Incident_Overview_PWA's XPath).
export function isSameDay(iso: string, now: Date, timeZone: string): boolean {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  return fmt.format(new Date(iso)) === fmt.format(now);
}
