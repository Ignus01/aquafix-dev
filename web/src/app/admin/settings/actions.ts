"use server";

import { revalidatePath } from "next/cache";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireRole } from "@/lib/auth";
import { friendlyError } from "@/lib/db-errors";
import type {
  EmailLogRow,
  KeyCheckResult,
  SettingsAuditRow,
  SettingsForm,
  SystemSettings,
} from "@/lib/settings/types";

// Admin → System Settings. Every action is system_admin-only here, and again
// in the database (RLS + the RPCs' require_system_admin()) and in the Edge
// Functions — hiding the menu item isn't the gate (spec "Navigation").

type ActionResult = { error: string | null };

async function requireSystemAdmin() {
  await requireRole(["system_admin"]);
}

function revalidate() {
  revalidatePath("/admin/settings");
}

async function names(ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const map = new Map<string, string>();
  if (unique.length === 0) return map;
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_user_names", { p_ids: unique });
  for (const row of (data ?? []) as { id: string; name: string }[]) map.set(row.id, row.name);
  return map;
}

export async function getSettings(): Promise<SystemSettings> {
  await requireSystemAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("system_settings")
    .select(
      "email_enabled, brevo_secret_id, brevo_key_last4, brevo_key_status, brevo_key_checked_at, " +
        "brevo_key_account, brevo_key_changed_at, brevo_key_changed_by, sender_name, sender_email, " +
        "reply_to_email, app_url, time_zone, vat_rate",
    )
    .eq("id", 1)
    .single();
  if (error) throw error;
  const row = data as unknown as Omit<SystemSettings, "has_key" | "brevo_key_changed_by_name"> & {
    brevo_secret_id: string | null;
    brevo_key_changed_by: string | null;
  };
  const nameMap = await names([row.brevo_key_changed_by]);
  const { brevo_secret_id, brevo_key_changed_by, ...rest } = row;
  return {
    ...rest,
    vat_rate: Number(row.vat_rate),
    has_key: brevo_secret_id !== null,
    brevo_key_changed_by_name: brevo_key_changed_by ? (nameMap.get(brevo_key_changed_by) ?? null) : null,
  };
}

export async function listEmailLog(): Promise<EmailLogRow[]> {
  await requireSystemAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("email_log")
    .select(
      "id, created_at, tag, outbox_id, recipient_email, subject, status, attempt, http_status, " +
        "brevo_message_id, error_reason, response_body, incident:incident_id(reference)",
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(500);
  if (error) throw error;

  const rows = data as unknown as (Omit<EmailLogRow, "incident_reference" | "can_resend"> & {
    outbox_id: number | null;
    incident: { reference: number } | null;
  })[];
  // Rows are newest first, so the first row seen per outbox is its latest.
  const latestPerOutbox = new Map<number, number>();
  for (const r of rows) {
    if (r.outbox_id !== null && !latestPerOutbox.has(r.outbox_id)) latestPerOutbox.set(r.outbox_id, r.id);
  }
  return rows.map(({ outbox_id, incident, ...r }) => ({
    ...r,
    incident_reference: incident?.reference ?? null,
    can_resend:
      r.status === "failed" && outbox_id !== null && latestPerOutbox.get(outbox_id) === r.id,
  }));
}

export async function listSettingsAudit(): Promise<SettingsAuditRow[]> {
  await requireSystemAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("settings_audit")
    .select("id, changed_at, changed_by, field, old_value, new_value")
    .order("changed_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  const nameMap = await names(data.map((r) => r.changed_by));
  return data.map(({ changed_by, ...r }) => ({
    ...r,
    changed_by_name: changed_by ? (nameMap.get(changed_by) ?? null) : null,
  }));
}

function isProduction() {
  return process.env.VERCEL_ENV
    ? process.env.VERCEL_ENV === "production"
    : process.env.NODE_ENV === "production";
}

// update_system_settings (SET-R06..R08, R11). The database validates
// everything; localhost is only refused here because only the app knows
// which environment it runs in (SET-R07).
export async function saveSettings(form: SettingsForm): Promise<ActionResult> {
  await requireSystemAdmin();
  const appUrl = form.app_url.trim();
  if (isProduction() && /^http:\/\//i.test(appUrl)) {
    return { error: "App URL must be an absolute https:// URL." };
  }
  const vat = Number(form.vat_percent);
  if (form.vat_percent.trim() === "" || Number.isNaN(vat)) {
    return { error: "VAT must be a percentage between 0 and 100, with up to 2 decimals." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("update_system_settings", {
    p_email_enabled: form.email_enabled,
    p_sender_name: form.sender_name,
    p_sender_email: form.sender_email,
    p_reply_to_email: form.reply_to_email,
    p_app_url: appUrl,
    p_time_zone: form.time_zone,
    p_vat_percent: vat,
  });
  if (error) return { error: friendlyError(error) };
  revalidate();
  return { error: null };
}

async function invokeFunction<T>(name: string): Promise<{ data: T | null; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.functions.invoke(name, { method: "POST", body: {} });
  if (!error) return { data: data as T, error: null };
  if (error instanceof FunctionsHttpError) {
    const body = await (error.context as Response).json().catch(() => null);
    return { data: null, error: body?.error ?? "The request failed." };
  }
  return { data: null, error: "Could not reach the email service. Try again." };
}

async function validateKey(): Promise<{ error: string | null; check?: KeyCheckResult }> {
  const { data, error } = await invokeFunction<KeyCheckResult>("brevo-validate-key");
  if (error || !data) return { error: error ?? "Could not check the key." };
  return { error: null, check: data };
}

// SET-R02..R04: store the key (write-only), then check it against Brevo.
export async function setApiKey(
  key: string,
): Promise<{ error: string | null; check?: KeyCheckResult }> {
  await requireSystemAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_brevo_api_key", { p_key: key });
  if (error) return { error: friendlyError(error) };
  const result = await validateKey();
  revalidate();
  // The key is saved even if the check couldn't run; its status stays "unknown".
  return result.error ? { error: null } : result;
}

// "Test connection" (SET-R04 on demand).
export async function testConnection(): Promise<{ error: string | null; check?: KeyCheckResult }> {
  await requireSystemAdmin();
  const result = await validateKey();
  revalidate();
  return result;
}

// SET-R05.
export async function removeApiKey(): Promise<ActionResult> {
  await requireSystemAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_brevo_api_key");
  if (error) return { error: friendlyError(error) };
  revalidate();
  return { error: null };
}

// SET-R09.
export async function sendTestEmail(): Promise<{ error: string | null; messageId?: string; recipient?: string }> {
  await requireSystemAdmin();
  const { data, error } = await invokeFunction<{ messageId: string | null; recipient: string }>(
    "brevo-send-test",
  );
  revalidate();
  if (error || !data) return { error: error ?? "Brevo rejected the email." };
  return { error: null, messageId: data.messageId ?? undefined, recipient: data.recipient };
}

// EML-R12.
export async function resendEmail(logId: number): Promise<ActionResult> {
  await requireSystemAdmin();
  const supabase = await createClient();
  const { error } = await supabase.rpc("resend_email", { p_log_id: logId });
  if (error) return { error: friendlyError(error) };
  revalidate();
  return { error: null };
}
