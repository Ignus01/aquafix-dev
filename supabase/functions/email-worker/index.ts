// email-worker — sends queued incident notifications (EML-R04).
//
// Called by the database (pg_net) right after an incident's outbox rows are
// committed, and every minute by pg_cron while anything is due. Authenticated
// with the `email_worker_secret` Vault secret the database sends in the
// x-worker-secret header. Claims rows with FOR UPDATE SKIP LOCKED, so two
// overlapping runs never send the same email.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { json, serviceClient } from "../_shared/clients.ts";
import { type EmailConfig, sendBrevoEmail, type SendResult } from "../_shared/brevo.ts";
import { formatLoggedAt, incidentUrl, renderIncidentEmail } from "../_shared/incident-template.ts";

// Stay well inside the Edge Function wall-clock limit.
const TIME_BUDGET_MS = 45_000;
const BATCH_SIZE = 10;

type OutboxRow = {
  id: number;
  template: string;
  incident_id: string;
  recipient_email: string;
  recipient_name: string | null;
  attempts: number;
};

type IncidentContext = {
  reference: number;
  incident_type: string;
  location_name: string;
  logged_by: string | null;
  created_at: string;
  comment: string;
};

async function processRow(
  db: SupabaseClient,
  config: EmailConfig,
  row: OutboxRow,
): Promise<{ subject: string | null; result: SendResult }> {
  const fail = (errorReason: string): SendResult => ({
    outcome: "failed",
    httpStatus: null,
    messageId: null,
    responseBody: null,
    errorReason,
  });

  const { data: ctx, error } = await db.rpc("incident_email_context", {
    p_incident_id: row.incident_id,
  });
  if (error) {
    return {
      subject: null,
      result: { ...fail("Could not load the incident"), outcome: "retry" },
    };
  }
  if (!ctx) return { subject: null, result: fail("incident not found") };
  const incident = ctx as IncidentContext;
  const reference = String(incident.reference);

  const email = renderIncidentEmail({
    // EML-R07: full name, falling back to the part of the email before @.
    to_name: row.recipient_name || row.recipient_email.split("@")[0],
    location_name: incident.location_name,
    reference,
    incident_type: incident.incident_type,
    logged_by: incident.logged_by ?? "",
    logged_at: formatLoggedAt(incident.created_at, config.time_zone),
    description: incident.comment,
    incident_url: incidentUrl(config.app_url, reference),
  });

  // Settings may have changed since the row was queued (EML-R03).
  if (!config.email_enabled) return { subject: email.subject, result: fail("email disabled") };
  if (!config.api_key) return { subject: email.subject, result: fail("no api key") };
  if (!config.sender_email) return { subject: email.subject, result: fail("no sender email") };

  const result = await sendBrevoEmail(config, {
    to: { email: row.recipient_email, name: row.recipient_name || row.recipient_email.split("@")[0] },
    subject: email.subject,
    html: email.html,
    text: email.text,
    tags: ["incident-notification", `incident-${reference}`],
  });
  return { subject: email.subject, result };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const db = serviceClient();
  const { data: authorized } = await db.rpc("email_worker_secret_matches", {
    p_secret: req.headers.get("x-worker-secret") ?? "",
  });
  if (authorized !== true) return json({ error: "Unauthorized" }, 401);

  const { data: config, error: configError } = await db.rpc("get_email_config");
  if (configError || !config) {
    console.error("email-worker: could not load settings", configError?.message);
    return json({ error: "Could not load settings" }, 500);
  }

  const started = Date.now();
  const counts = { sent: 0, retry: 0, failed: 0 };

  while (Date.now() - started < TIME_BUDGET_MS) {
    const { data: rows, error } = await db.rpc("claim_email_outbox", { p_limit: BATCH_SIZE });
    if (error) {
      console.error("email-worker: claim failed", error.message);
      break;
    }
    if (!rows || rows.length === 0) break;

    for (const row of rows as OutboxRow[]) {
      const { subject, result } = await processRow(db, config as EmailConfig, row);
      counts[result.outcome] += 1;
      const { error: recordError } = await db.rpc("record_email_attempt", {
        p_outbox_id: row.id,
        p_outcome: result.outcome,
        p_subject: subject,
        p_http_status: result.httpStatus,
        p_message_id: result.messageId,
        p_response_body: result.responseBody,
        p_error_reason: result.errorReason,
      });
      if (recordError) {
        // The row stays `sending` and is reclaimed after 5 minutes.
        console.error(`email-worker: could not record outbox ${row.id}`, recordError.message);
      }
    }
  }

  return json(counts);
});
