"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/supabase/select-all";
import { friendlyError } from "@/lib/db-errors";
import { BILLING_ADMINS } from "@/lib/billing/permissions";
import { num, parsePeriod } from "@/lib/billing/format";
import type {
  BillingMeter,
  BillingRunRow,
  InvoiceLine,
  InvoiceLineView,
  InvoiceRow,
  NearbyReading,
  ReadingSide,
  SetupLocation,
  SetupMeter,
} from "@/lib/billing/types";
import { billingMeterOf } from "@/lib/billing/types";
import type { AssetClassification } from "@/lib/masterdata/types";

// Admin → Billing. Reads use the caller's session (RLS: system admins and
// admins); every write goes through a billing_* function, which checks the
// role again.

type Supabase = Awaited<ReturnType<typeof createClient>>;
type DbError = { code?: string; message: string; details?: string | null };
export type ActionResult = { error: string | null };

const IMAGE_BUCKET = "inspection-images";
const SIGNED_URL_TTL = 60 * 30;

// Messages raised by the billing functions are written for the user.
function errorText(error: DbError) {
  return error.code === "P0001" || error.code === "42501" ? error.message : friendlyError(error);
}

function revalidate() {
  revalidatePath("/admin/billing", "layout");
}

async function userNames(supabase: Supabase, ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const { data } = await supabase.rpc("get_user_names", { p_ids: unique });
  for (const row of (data ?? []) as { id: string; name: string }[]) map.set(row.id, row.name);
  return map;
}

async function signImages(supabase: Supabase, paths: (string | null)[]) {
  const unique = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  const urls = new Map<string, string>();
  if (unique.length === 0) return urls;
  const { data } = await supabase.storage.from(IMAGE_BUCKET).createSignedUrls(unique, SIGNED_URL_TTL);
  for (const entry of data ?? []) if (entry.path && entry.signedUrl) urls.set(entry.path, entry.signedUrl);
  return urls;
}

const INVOICE_COLUMNS =
  "id, billing_run_id, location_id, location_name, organisation_name, region_name, status, invoice_no, billing_day, " +
  "period_start, period_end, tariff_rate, treated_usage, amount, issues, generated_at, approved_at, approved_by, " +
  "voided_at, void_reason";

function toInvoice(r: Record<string, unknown>): InvoiceRow {
  return {
    ...(r as unknown as InvoiceRow),
    tariff_rate: num(r.tariff_rate),
    treated_usage: num(r.treated_usage),
    amount: num(r.amount),
  };
}

function toLine(r: Record<string, unknown>): InvoiceLine {
  return {
    ...(r as unknown as InvoiceLine),
    prev_value: num(r.prev_value),
    curr_value: num(r.curr_value),
    usage: num(r.usage),
  };
}

// ============================================================================
// Runs
// ============================================================================
export async function listRuns(): Promise<BillingRunRow[]> {
  await requireRole(BILLING_ADMINS);
  const supabase = await createClient();
  const { data: runs, error } = await supabase
    .from("billing_run")
    .select("id, period, generated_at")
    .order("period", { ascending: false });
  if (error) throw error;
  const invoices = await selectAll(() =>
    supabase.from("invoice").select("id, billing_run_id, status, amount").order("id"),
  );
  return (runs ?? []).map((run) => {
    const mine = invoices.filter((i) => i.billing_run_id === run.id);
    const sum = (status: string) =>
      mine.filter((i) => i.status === status).reduce((t, i) => t + (num(i.amount) ?? 0), 0);
    return {
      id: run.id,
      period: run.period,
      generated_at: run.generated_at,
      draft: mine.filter((i) => i.status === "draft").length,
      approved: mine.filter((i) => i.status === "approved").length,
      void: mine.filter((i) => i.status === "void").length,
      amount_approved: sum("approved"),
      amount_draft: sum("draft"),
    };
  });
}

export async function getRun(id: string): Promise<{ id: string; period: string; generated_at: string } | null> {
  await requireRole(BILLING_ADMINS);
  const supabase = await createClient();
  const { data, error } = await supabase.from("billing_run").select("id, period, generated_at").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function listRunInvoices(runId: string): Promise<InvoiceRow[]> {
  await requireRole(BILLING_ADMINS);
  const supabase = await createClient();
  const rows = await selectAll(() =>
    supabase.from("invoice").select(INVOICE_COLUMNS).eq("billing_run_id", runId).order("location_name").order("id"),
  );
  return (rows as unknown as Record<string, unknown>[]).map(toInvoice);
}

export async function generateRun(
  period: string,
  locationIds: string[] | null = null,
): Promise<{ error: string | null; runId?: string; created?: number; skipped?: number }> {
  await requireRole(BILLING_ADMINS);
  const p = parsePeriod(period);
  if (!p) return { error: "Choose a month to bill." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("billing_generate", {
    p_period: p,
    p_location_ids: locationIds && locationIds.length > 0 ? locationIds : null,
  });
  if (error) return { error: errorText(error) };
  revalidate();
  const result = data as { run_id: string; created: number; skipped_approved: number };
  return { error: null, runId: result.run_id, created: result.created, skipped: result.skipped_approved };
}

export async function approveInvoices(
  ids: string[],
): Promise<{ error: string | null; approved?: number; skipped?: { location: string; reason: string }[] }> {
  await requireRole(BILLING_ADMINS);
  if (ids.length === 0) return { error: "Select the invoices to approve." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("billing_approve", { p_invoice_ids: ids });
  if (error) return { error: errorText(error) };
  revalidate();
  const result = data as { approved: number; skipped: { location: string; reason: string }[] };
  return { error: null, approved: result.approved, skipped: result.skipped };
}

export async function voidInvoice(id: string, reason: string): Promise<ActionResult> {
  await requireRole(BILLING_ADMINS);
  const supabase = await createClient();
  const { error } = await supabase.rpc("billing_void", { p_invoice_id: id, p_reason: reason });
  if (error) return { error: errorText(error) };
  revalidate();
  return { error: null };
}

// ============================================================================
// One invoice
// ============================================================================
export type InvoiceDetail = {
  invoice: InvoiceRow;
  lines: InvoiceLineView[];
  approvedByName: string | null;
  period: string;
};

export async function getInvoice(id: string): Promise<InvoiceDetail | null> {
  await requireRole(BILLING_ADMINS);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("invoice")
    .select(`${INVOICE_COLUMNS}, billing_run:billing_run_id(period)`)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const record = data as unknown as Record<string, unknown> & { billing_run: { period: string } | null };
  const invoice = toInvoice(record);

  const { data: lineRows, error: lineError } = await supabase
    .from("invoice_line")
    .select("*")
    .eq("invoice_id", id)
    .order("sort_order");
  if (lineError) throw lineError;
  const lines = (lineRows ?? []).map(toLine);
  const urls = await signImages(supabase, lines.flatMap((l) => [l.prev_image_path, l.curr_image_path]));
  const names = await userNames(supabase, [invoice.approved_by]);

  return {
    invoice,
    period: record.billing_run?.period ?? invoice.period_end,
    approvedByName: invoice.approved_by ? (names.get(invoice.approved_by) ?? null) : null,
    lines: lines.map((l) => ({
      ...l,
      prev_image_url: l.prev_image_path ? (urls.get(l.prev_image_path) ?? null) : null,
      curr_image_url: l.curr_image_path ? (urls.get(l.curr_image_path) ?? null) : null,
    })),
  };
}

export async function listLineReadings(
  lineId: string,
  side: ReadingSide,
): Promise<{ error: string | null; readings: (NearbyReading & { image_url: string | null })[] }> {
  await requireRole(BILLING_ADMINS);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("billing_line_readings", { p_line_id: lineId, p_side: side, p_limit: 12 });
  if (error) return { error: errorText(error), readings: [] };
  const rows = ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...(r as unknown as NearbyReading),
    value: Number(r.value),
  }));
  const urls = await signImages(supabase, rows.map((r) => r.image_path));
  return {
    error: null,
    readings: rows.map((r) => ({ ...r, image_url: r.image_path ? (urls.get(r.image_path) ?? null) : null })),
  };
}

// valueId: use that reading; manualValue: a typed value (note required);
// neither: back to the reading the generator picks.
export async function setReading(
  lineId: string,
  side: ReadingSide,
  choice: { valueId?: string | null; manualValue?: number | null; note?: string | null },
): Promise<ActionResult> {
  await requireRole(BILLING_ADMINS);
  const supabase = await createClient();
  const { error } = await supabase.rpc("billing_set_reading", {
    p_line_id: lineId,
    p_side: side,
    p_value_id: choice.valueId ?? null,
    p_manual_value: choice.manualValue ?? null,
    p_note: choice.note ?? null,
  });
  if (error) return { error: errorText(error) };
  revalidate();
  return { error: null };
}

// ============================================================================
// Setup
// ============================================================================
export async function getSetup(): Promise<SetupLocation[]> {
  await requireRole(BILLING_ADMINS);
  const supabase = await createClient();

  const [locations, tariffs, assets] = await Promise.all([
    selectAll(() =>
      supabase
        .from("location")
        .select("id, name, billing_day, organisation:organisation_id(name), region:region_id(name)")
        .eq("active", true)
        .order("name")
        .order("id"),
    ),
    selectAll(() =>
      supabase.from("location_tariff").select("id, location_id, rate, effective_from").order("effective_from", { ascending: false }).order("id"),
    ),
    selectAll(() =>
      supabase
        .from("asset")
        .select("id, name, code, location_id, asset_type:asset_type_id(name, classification)")
        .eq("active", true)
        .order("name")
        .order("id"),
    ),
  ]);

  // The location's active meters: assets whose type is classified as a meter,
  // or whose type name says meter (an unclassified one shows as not billed,
  // so it can be fixed in master data). Billed meters first, as on the invoice.
  type AssetRec = {
    id: string;
    name: string;
    code: string;
    location_id: string;
    asset_type: { name: string; classification: AssetClassification } | null;
  };
  const order: (BillingMeter | null)[] = ["treated", "borehole", "municipal", "electrical", null];
  const meters = new Map<string, SetupMeter[]>();
  for (const a of assets as unknown as AssetRec[]) {
    const classification = a.asset_type?.classification ?? "OTHER";
    const typeName = a.asset_type?.name ?? "";
    if (classification === "OTHER" && !/meter/i.test(typeName)) continue;
    const list = meters.get(a.location_id) ?? [];
    list.push({
      id: a.id,
      name: a.name,
      code: a.code,
      asset_type: typeName,
      classification,
      billing_meter: billingMeterOf(classification),
    });
    meters.set(a.location_id, list);
  }
  for (const list of meters.values()) {
    list.sort((x, y) => order.indexOf(x.billing_meter) - order.indexOf(y.billing_meter));
  }

  type LocRec = {
    id: string;
    name: string;
    billing_day: number | null;
    organisation: { name: string } | null;
    region: { name: string } | null;
  };
  return (locations as unknown as LocRec[]).map((l) => ({
    id: l.id,
    name: l.name,
    organisation: l.organisation?.name ?? null,
    region: l.region?.name ?? null,
    billing_day: l.billing_day,
    tariffs: (tariffs as { id: string; location_id: string; rate: unknown; effective_from: string }[])
      .filter((t) => t.location_id === l.id)
      .map((t) => ({ id: t.id, rate: Number(t.rate), effective_from: t.effective_from })),
    meters: meters.get(l.id) ?? [],
  }));
}

export async function setBillingDay(locationId: string, day: number | null): Promise<ActionResult> {
  await requireRole(BILLING_ADMINS);
  if (day !== null && (!Number.isInteger(day) || day < 1 || day > 31)) return { error: "The billing day must be 1–31." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("billing_set_location", { p_location_id: locationId, p_billing_day: day });
  if (error) return { error: errorText(error) };
  revalidate();
  return { error: null };
}

export async function addTariff(locationId: string, rate: number, effectiveFrom: string): Promise<ActionResult> {
  await requireRole(BILLING_ADMINS);
  const supabase = await createClient();
  const { error } = await supabase.rpc("billing_set_tariff", {
    p_location_id: locationId,
    p_rate: rate,
    p_effective_from: effectiveFrom || null,
  });
  if (error) return { error: errorText(error) };
  revalidate();
  return { error: null };
}

export async function deleteTariff(id: string): Promise<ActionResult> {
  await requireRole(BILLING_ADMINS);
  const supabase = await createClient();
  const { error } = await supabase.rpc("billing_delete_tariff", { p_tariff_id: id });
  if (error) return { error: errorText(error) };
  revalidate();
  return { error: null };
}
