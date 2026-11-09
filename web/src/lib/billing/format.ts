// Money in rand, quantities with up to 2 decimals, in a fixed locale so the
// server render and the browser agree.

const money = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const rate = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 });

export const formatMoney = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `R ${money.format(n)}`);
export const formatQty = (n: number | null | undefined) => (n === null || n === undefined ? "—" : qty.format(n));
export const formatRate = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `R ${rate.format(n)}`);

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// "2026-11-01" → "November 2026".
export function formatPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

// "2026-11" (month input) or "2026-11-01" → "2026-11-01"; null if invalid.
export function parsePeriod(value: string | undefined | null): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(value ?? "");
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  return `${m[1]}-${m[2]}-01`;
}

export const billingDayLabel = (day: number | null) =>
  day === null ? "Not billed" : day === 31 ? "Last day of month" : `Day ${day}`;

// numeric columns arrive as numbers or strings depending on size.
export const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
