// Calendar days in the app's time zone (system_settings, default
// Africa/Johannesburg), matching public.app_today() in the database.

const ymdFormat = (timeZone: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });

// `YYYY-MM-DD` of `at` (default now) in the zone.
export function todayInZone(timeZone: string, at: Date = new Date()): string {
  return ymdFormat(timeZone).format(at);
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

// The instant of local midnight today in the zone, as an ISO string — for
// "from today" queries (Inspection_Overview_PWA's BeginOfCurrentDay).
export function startOfTodayIso(timeZone: string, at: Date = new Date()): string {
  return zonedWallTimeToDate(new Date(`${todayInZone(timeZone, at)}T00:00:00Z`), timeZone).toISOString();
}

// ISO timestamp → `YYYY-MM-DDTHH:mm` for a datetime-local input, in the zone
// (not the browser's, so the server render matches).
export function isoToZonedInput(iso: string, timeZone: string): string {
  if (!iso) return "";
  const p = zonedParts(new Date(iso), timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

// The reverse: a datetime-local value read as wall time in the zone.
export function zonedInputToIso(value: string, timeZone: string): string {
  if (!value) return "";
  return zonedWallTimeToDate(new Date(`${value}:00Z`), timeZone).toISOString();
}

// `DD Mon YYYY` for a plain date column (no time zone shift).
export function formatPlainDate(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-").map(Number);
  const month = new Date(Date.UTC(y, m - 1, d)).toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${String(d).padStart(2, "0")} ${month} ${y}`;
}
