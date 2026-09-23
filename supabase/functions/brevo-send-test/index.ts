// brevo-send-test — SET-R09. Sends the real incident template, filled with
// sample data, to the calling system admin's own address through the same
// Brevo path as real notifications, and logs it with the `test` tag.
// Limited to 5 test sends per admin per hour.

import { json, requireSystemAdmin, serviceClient } from "../_shared/clients.ts";
import { type EmailConfig, sendBrevoEmail } from "../_shared/brevo.ts";
import { formatLoggedAt, incidentUrl, renderIncidentEmail } from "../_shared/incident-template.ts";

const HOURLY_LIMIT = 5;

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = await requireSystemAdmin(req);
  if (admin instanceof Response) return admin;
  if (!admin.email) return json({ error: "Your account has no email address." }, 400);

  const db = serviceClient();

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error: countError } = await db
    .from("email_log")
    .select("id", { count: "exact", head: true })
    .eq("tag", "test")
    .eq("triggered_by", admin.id)
    .gte("created_at", since);
  if (countError) return json({ error: "Could not check the send limit." }, 500);
  if ((count ?? 0) >= HOURLY_LIMIT) {
    return json({ error: `You can send up to ${HOURLY_LIMIT} test emails an hour. Try again later.` }, 429);
  }

  const { data: configData, error } = await db.rpc("get_email_config");
  if (error || !configData) return json({ error: "Could not load settings." }, 500);
  const config = configData as EmailConfig;
  if (!config.api_key) return json({ error: "Add a Brevo API key first." }, 400);
  if (!config.sender_email) return json({ error: "Set and save a sender email first." }, 400);

  const { data: profile } = await db.from("profiles").select("username").eq("id", admin.id).maybeSingle();
  const name = profile?.username?.trim() || admin.email.split("@")[0];

  const email = renderIncidentEmail({
    to_name: name,
    location_name: "Sample location",
    reference: "TEST",
    incident_type: "Test incident",
    logged_by: name,
    logged_at: formatLoggedAt(new Date().toISOString(), config.time_zone),
    description:
      "This is a test of the AquaFix incident notification.\nNo incident was logged and no action is needed.",
    incident_url: incidentUrl(config.app_url, "TEST"),
  });

  const result = await sendBrevoEmail(config, {
    to: { email: admin.email, name },
    subject: email.subject,
    html: email.html,
    text: email.text,
    tags: ["incident-notification", "test"],
  });

  const sent = result.outcome === "sent";
  await db.from("email_log").insert({
    tag: "test",
    recipient_email: admin.email.toLowerCase(),
    subject: email.subject,
    status: sent ? "sent" : "failed",
    attempt: 1,
    http_status: result.httpStatus,
    brevo_message_id: result.messageId,
    response_body: result.responseBody?.slice(0, 4096) ?? null,
    error_reason: result.errorReason,
    triggered_by: admin.id,
  });
  if (result.httpStatus !== null) {
    await db.rpc("record_brevo_http_status", { p_http_status: result.httpStatus });
  }

  if (!sent) return json({ error: result.errorReason ?? "Brevo rejected the email." }, 502);
  return json({ messageId: result.messageId, recipient: admin.email });
});
