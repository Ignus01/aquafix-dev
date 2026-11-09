// Billing (supabase/migrations/20261108120000_billing.sql).

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

export type SetupMeter = {
  id: string;
  name: string;
  code: string;
  active: boolean;
  asset_type: string;
  billing_meter: BillingMeter | null;
};

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
