// The field app shows dates as dd/MM/yyyy HH:mm in the app's time zone.
export function shortDateTime(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })
    .format(new Date(iso))
    .replace(",", "");
}

export function shortDate(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone, day: "2-digit", month: "2-digit", year: "numeric" }).format(
    new Date(iso),
  );
}

// "01 Oct 2026" — the style of the PWA's date inputs.
export function longDate(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-GB", { timeZone, day: "2-digit", month: "short", year: "numeric" }).format(
    new Date(iso),
  );
}
