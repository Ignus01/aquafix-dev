// Billing (supabase/migrations/20261109140000_billing.sql).

import type { AssetClassification } from "@/lib/masterdata/types";

export type BillingMeter = "treated" | "borehole" | "electrical";
export type InvoiceStatus = "draft" | "approved" | "void";
export type ReadingSource = "window" | "closest" | "previous_invoice" | "selected" | "manual" | "none";
export type ReadingSide = "prev" | "curr";

export const BILLING_METER_OPTIONS: { value: BillingMeter; label: string }[] = [
  { value: "treated", label: "Treated water" },
  { value: "borehole", label: "Borehole" },
  { value: "electrical", label: "Electrical" },
];

export const billingMeterLabel = (m: BillingMeter | null) =>
  BILLING_METER_OPTIONS.find((o) => o.value === m)?.label ?? "Not billed";

// Units shown next to readings and usage.
export const METER_UNIT: Record<BillingMeter, string> = {
  treated: "kL",
  borehole: "kL",
  electrical: "kWh",
};

export type BillingRunRow = {
  id: string;
  // First day of the period month, YYYY-MM-DD.
  period: string;
  generated_at: string;
  draft: number;
  approved: number;
  void: number;
  amount_approved: number;
  amount_draft: number;
};

export type InvoiceRow = {
  id: string;
  billing_run_id: string;
  location_id: string;
  location_name: string;
  organisation_name: string | null;
  region_name: string | null;
  status: InvoiceStatus;
  invoice_no: string | null;
  billing_day: number;
  period_start: string;
  period_end: string;
  tariff_rate: number | null;
  treated_usage: number | null;
  amount: number | null;
  issues: string[];
  generated_at: string;
  approved_at: string | null;
  approved_by: string | null;
  voided_at: string | null;
  void_reason: string | null;
};

export type InvoiceLine = {
  id: string;
  invoice_id: string;
  asset_id: string;
  asset_name: string;
  asset_code: string;
  meter: BillingMeter;
  sort_order: number;
  prev_value: number | null;
  prev_read_at: string | null;
  prev_value_id: string | null;
  prev_image_path: string | null;
  prev_source: ReadingSource;
  curr_value: number | null;
  curr_read_at: string | null;
  curr_value_id: string | null;
  curr_image_path: string | null;
  curr_source: ReadingSource;
  usage: number | null;
  issues: string[];
  note: string;
};

// A line with signed photo URLs for the page.
export type InvoiceLineView = InvoiceLine & { prev_image_url: string | null; curr_image_url: string | null };

export type NearbyReading = {
  value_id: string;
  value: number;
  read_at: string;
  day_diff: number;
  image_path: string | null;
};

// A meter at a location, as billing sees it. What it is billed as comes from
// its asset type's classification (public.billing_meter_of); municipal and
// unclassified meters are not billed.
export type SetupMeter = {
  id: string;
  name: string;
  code: string;
  asset_type: string;
  classification: AssetClassification;
  billing_meter: BillingMeter | null;
};

// public.billing_meter_of(): the classifications that go on an invoice.
export const billingMeterOf = (c: AssetClassification): BillingMeter | null =>
  c === "TREATED_METER" ? "treated" : c === "BOREHOLE_METER" ? "borehole" : c === "ELECTRICAL_METER" ? "electrical" : null;

export type SetupTariff = { id: string; rate: number; effective_from: string };

export type SetupLocation = {
  id: string;
  name: string;
  organisation: string | null;
  region: string | null;
  billing_day: number | null;
  tariffs: SetupTariff[];
  meters: SetupMeter[];
};
