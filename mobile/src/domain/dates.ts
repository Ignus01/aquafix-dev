// Calendar days in the app's time zone (system_settings, default
// Africa/Johannesburg), matching public.app_today() in the database. Copied
// from web/src/lib/inspections/dates.ts and web/src/app/m/format.ts so the
// phone shows dates exactly as the PWA does. "Today" is never the phone's own
// time zone.

export const DEFAULT_TIME_ZONE = "Africa/Johannesburg";

// Timestamps arrive from sync as Postgres-style text ("2026-11-04 06:02:31.1Z"
// or "...+00"); Hermes only parses strict ISO 8601. Normalise before parsing.
export function toDate(value: string): Date {
  let s = value.trim();
  if (/^\d{4}-\d{2}-\d{2} /.test(s)) s = s.replace(" ", "T");
  s = s.replace(/([+-]\d{2})$/, "$1:00").replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  return new Date(s);
}

const ymdFormat = (timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });

// `YYYY-MM-DD` of `at` (default now) in the zone.
export function todayInZone(timeZone: string, at: Date = new Date()): string {
  return ymdFormat(timeZone).format(at);
}

export function zonedDay(timeZone: string): (iso: string) => string {
  const format = ymdFormat(timeZone);
  return (iso) => format.format(toDate(iso));
}

function zonedParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

// The instant at which the zone's wall clock reads `wall` (given as UTC
// fields). Two passes settle DST edges.
function zonedWallTimeToDate(wall: Date, timeZone: string): Date {
  let guess = wall.getTime();
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(guess), timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess -= asUtc - wall.getTime();
  }
  return new Date(guess);
}

// Local midnight of `ymd` in the zone, as an ISO string.
export function startOfDayIso(ymd: string, timeZone: string): string {
  return zonedWallTimeToDate(new Date(`${ymd}T00:00:00Z`), timeZone).toISOString();
}

// Local midnight today in the zone (Inspection_Overview_PWA's BeginOfCurrentDay).
export function startOfTodayIso(timeZone: string, at: Date = new Date()): string {
  return startOfDayIso(todayInZone(timeZone, at), timeZone);
}

// `YYYY-MM-DD` that is `days` calendar days before `ymd`.
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

// "The last 7 days": today plus the 6 days before, app time zone. Returns the
// first day (inclusive) as `YYYY-MM-DD`; later dates (future) count too.
export function sevenDayWindowStart(timeZone: string, at: Date = new Date()): string {
  return addDays(todayInZone(timeZone, at), -6);
}

// ISO → `YYYY-MM-DDTHH:mm` wall time in the zone.
export function isoToZonedInput(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  const p = zonedParts(toDate(iso), timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

// The reverse: `YYYY-MM-DDTHH:mm` read as wall time in the zone.
export function zonedInputToIso(value: string, timeZone: string): string {
  if (!value) return "";
  return zonedWallTimeToDate(new Date(`${value}:00Z`), timeZone).toISOString();
}

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
    .format(toDate(iso))
    .replace(",", "");
}

export function shortDate(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  // A plain `YYYY-MM-DD` date has no time zone; show it as it is.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  }
  return new Intl.DateTimeFormat("en-GB", { timeZone, day: "2-digit", month: "2-digit", year: "numeric" }).format(
    toDate(iso),
  );
}

// The day (`YYYY-MM-DD`, app time zone) of a timestamp or plain date.
export function dayOf(value: string, timeZone: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return todayInZone(timeZone, toDate(value));
}

// ISO 8601 with an explicit offset (`Z`), as every command's captured_at.
export function nowIso(): string {
  return new Date().toISOString();
}
