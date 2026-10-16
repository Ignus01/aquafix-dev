import type { ResultStatus } from "./types";

// The evaluation rules of the spec. resultStatus() mirrors
// public.lab_result_status(); the pages read the database's status, and the
// import preview (before anything is saved) uses this one.

type Limits = { min_acceptable: number | null; max_acceptable: number | null };

export function resultStatus(value: number, belowDetection: boolean, limits: Limits): ResultStatus {
  const min = limits.min_acceptable;
  const max = limits.max_acceptable;
  if (min === null && max === null) return "no_limit";
  if (belowDetection) {
    if (min !== null && min > 0) return "low";
    if (max === null || max === 0 || value <= max) return "ok";
    return "inconclusive";
  }
  if (max !== null && value > max) return "high";
  if (min !== null && value < min) return "low";
  return "ok";
}

export const isOutOfSpec = (s: ResultStatus) => s === "high" || s === "low";

export const STATUS_LABELS: Record<ResultStatus, string> = {
  ok: "Acceptable",
  high: "High",
  low: "Low",
  inconclusive: "Inconclusive",
  no_limit: "No limit",
};

export const STATUS_ARROWS: Partial<Record<ResultStatus, string>> = { high: "↑", low: "↓" };

const trim = (n: number) => Number(n.toPrecision(12)).toString();

// A limit as written on the Parameters page: "5 – 9.7", "≤ 1.5", "≥ 5", "—".
export function rangeText(limits: Limits): string {
  const { min_acceptable: min, max_acceptable: max } = limits;
  if (min !== null && max !== null) return `${trim(min)} – ${trim(max)}`;
  if (max !== null) return `≤ ${trim(max)}`;
  if (min !== null) return `≥ ${trim(min)}`;
  return "—";
}

// "< 0.002" below detection (as the lab wrote it), else to the parameter's
// decimals.
export function formatResult(value: number, belowDetection: boolean, decimals: number): string {
  if (belowDetection) return `< ${trim(value)}`;
  return value.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// "Manganese · 0.857 mg/l · limit ≤ 0.4 · High"
export function resultTitle(
  name: string,
  text: string,
  unit: string,
  limits: Limits,
  status: ResultStatus,
): string {
  const range = rangeText(limits);
  const parts = [name, `${text} ${unit}`, range === "—" ? "no limit" : `limit ${range}`, STATUS_LABELS[status]];
  if (status === "inconclusive" && limits.max_acceptable !== null) {
    parts.push(`the lab's detection limit (${text}) is above the limit (${trim(limits.max_acceptable)})`);
  }
  return parts.join(" · ");
}

// ---- Matching lab names to Aquafix names ----------------------------------

const SUBSCRIPTS: Record<string, string> = {
  "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
};

// For comparing names only: case, subscripts (SO₄ = SO4), spaces and dots
// (E. coli = Ecoli) don't count.
export function nameKey(s: string): string {
  return s
    .replace(/[₀-₉]/g, (c) => SUBSCRIPTS[c] ?? c)
    .toLowerCase()
    .replace(/[\s.]+/g, "");
}

// Trimmed, with runs of whitespace collapsed: "20 - pH " → "20 - pH".
export const cleanText = (s: string) => s.replace(/\s+/g, " ").trim();

// The name after the lab's method code: "20 - pH" → "pH",
// "26 - TDS - cal" → "TDS".
export function labParameterName(header: string): string {
  const parts = cleanText(header).split(" - ");
  const name = parts.length > 1 ? parts[1] : parts[0];
  return name.trim();
}

export const sameUnit = (a: string | null | undefined, b: string | null | undefined) =>
  cleanText(a ?? "").toLowerCase() === cleanText(b ?? "").toLowerCase();
