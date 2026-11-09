import type { ReadingSource } from "./types";

// Issue codes written by billing_recalc_line / billing_recalc_invoice.
// Invoice issues from a treated meter's line carry a "treated:" prefix.

const LINE_LABELS: Record<string, string> = {
  no_prev_reading: "No opening reading",
  no_curr_reading: "No closing reading",
  prev_outside_window: "Opening reading not within ±1 day",
  curr_outside_window: "Closing reading not within ±1 day",
  no_prev_photo: "Opening reading has no photo",
  no_curr_photo: "Closing reading has no photo",
  same_reading: "Same reading at both ends",
  negative_usage: "Negative usage",
};

const INVOICE_LABELS: Record<string, string> = {
  no_tariff: "No tariff for this period",
  no_treated_meter: "No treated water meter",
  period_not_ended: "Billing date still to come",
};

// Mirrors public.billing_blocking_issues.
const BLOCKING = new Set([
  "no_tariff",
  "no_treated_meter",
  "treated:no_prev_reading",
  "treated:no_curr_reading",
  "treated:negative_usage",
]);

export const isBlocking = (code: string) => BLOCKING.has(code);

export function issueLabel(code: string): string {
  if (code.startsWith("treated:")) {
    const base = code.slice("treated:".length);
    return `Treated meter: ${(LINE_LABELS[base] ?? base).toLowerCase()}`;
  }
  return INVOICE_LABELS[code] ?? LINE_LABELS[code] ?? code;
}

// The issues worth listing for an invoice: its own, plus each line issue once
// (the treated-prefixed copy when there is one).
export function invoiceIssues(issues: string[]): { code: string; blocking: boolean }[] {
  const treated = new Set(issues.filter((c) => c.startsWith("treated:")).map((c) => c.slice(8)));
  return issues
    .filter((c) => c.startsWith("treated:") || INVOICE_LABELS[c] || !treated.has(c))
    .map((code) => ({ code, blocking: isBlocking(code) }))
    .sort((a, b) => Number(b.blocking) - Number(a.blocking));
}

export const SOURCE_LABELS: Record<ReadingSource, string> = {
  window: "On billing date",
  closest: "Closest reading",
  previous_invoice: "Previous invoice",
  selected: "Picked by reviewer",
  manual: "Typed by reviewer",
  none: "No reading",
};
