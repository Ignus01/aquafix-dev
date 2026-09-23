// The incident notification email (EML-R05..R07), ported from
// spec/incidents/templates/incident-notification.html. Every placeholder value
// is HTML-escaped; the description also keeps its line breaks.

export type IncidentEmailValues = {
  to_name: string;
  location_name: string;
  reference: string;
  incident_type: string;
  logged_by: string;
  logged_at: string;
  description: string;
  incident_url: string;
};

const EMPTY = "—"; // em dash

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function orDash(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  return v === "" ? EMPTY : v;
}

// `dd MMM yyyy, HH:mm` in the configured time zone (EML-R07), e.g.
// "23 Sep 2026, 14:05". Built from parts because en-GB's short month for
// September is "Sept" in current ICU.
export function formatLoggedAt(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")}`;
}

// app_url joined with /incidents/{reference}, exactly one slash between them.
export function incidentUrl(appUrl: string | null, reference: string): string {
  if (!appUrl) return "";
  return `${appUrl.replace(/\/+$/, "")}/incidents/${encodeURIComponent(reference)}`;
}

export function renderIncidentEmail(values: IncidentEmailValues): {
  subject: string;
  html: string;
  text: string;
} {
  const v = Object.fromEntries(
    Object.entries(values).map(([k, val]) => [k, orDash(val)]),
  ) as IncidentEmailValues;
  const h = Object.fromEntries(
    Object.entries(v).map(([k, val]) => [k, escapeHtml(val)]),
  ) as IncidentEmailValues;
  const descriptionHtml = h.description.replace(/\r\n|\r|\n/g, "<br>");
  const href = values.incident_url ? h.incident_url : "#";

  // EML-R05: plain text, no HTML.
  const subject = `${v.incident_type}: ${v.reference}`;

  const html = `<!DOCTYPE html><html>
<head>
<meta charset='utf-8'>
<meta name='viewport' content='width=device-width, initial-scale=1.0'>
</head>
<body style='margin:0; padding:0; background-color:#eef2f4; font-family:Arial, Helvetica, sans-serif;'>
<table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='background-color:#eef2f4; padding:24px 12px;'>
<tr>
<td align='center'>
<table role='presentation' width='600' cellpadding='0' cellspacing='0' style='max-width:600px; width:100%; background-color:#ffffff; border-radius:6px; overflow:hidden;'>
<tr>
<td style='background-color:#1B4F72; padding:22px 28px;'>
<span style='color:#ffffff; font-size:20px; font-weight:bold; letter-spacing:0.5px;'>AquaFix</span>
<span style='color:#9CC5D8; font-size:13px; display:block; margin-top:4px;'>Incident Notification</span>
</td>
</tr>
<tr>
<td style='padding:26px 28px 8px 28px;'>
<p style='margin:0 0 6px 0; font-size:15px; color:#222222;'>Hi ${h.to_name},</p>
<p style='margin:0 0 20px 0; font-size:15px; color:#444444; line-height:1.55;'>A new incident has been logged at <strong style='color:#1B4F72;'>${h.location_name}</strong>.</p>
</td>
</tr>
<tr>
<td style='padding:0 28px;'>
<table role='presentation' width='100%' cellpadding='0' cellspacing='0' style='border-collapse:collapse; border-left:4px solid #29ABE2; background-color:#f7fafb;'>
<tr>
<td style='padding:8px 0 8px 16px; font-size:13px; color:#777777; width:130px;'>Reference</td>
<td style='padding:8px 16px 8px 0; font-size:13px; color:#222222; font-weight:bold;'>${h.reference}</td>
</tr>
<tr>
<td style='padding:8px 0 8px 16px; font-size:13px; color:#777777;'>Incident type</td>
<td style='padding:8px 16px 8px 0; font-size:13px; color:#222222; font-weight:bold;'>${h.incident_type}</td>
</tr>
<tr>
<td style='padding:8px 0 8px 16px; font-size:13px; color:#777777;'>Location</td>
<td style='padding:8px 16px 8px 0; font-size:13px; color:#222222;'>${h.location_name}</td>
</tr>
<tr>
<td style='padding:8px 0 8px 16px; font-size:13px; color:#777777;'>Logged by</td>
<td style='padding:8px 16px 8px 0; font-size:13px; color:#222222;'>${h.logged_by}</td>
</tr>
<tr>
<td style='padding:8px 0 14px 16px; font-size:13px; color:#777777;'>Logged at</td>
<td style='padding:8px 16px 14px 0; font-size:13px; color:#222222;'>${h.logged_at}</td>
</tr>
</table>
</td>
</tr>
<tr>
<td style='padding:20px 28px 0 28px;'>
<p style='margin:0 0 6px 0; font-size:13px; color:#777777; font-weight:bold;'>Description</p>
<p style='margin:0; font-size:14px; color:#333333; line-height:1.55;'>${descriptionHtml}</p>
</td>
</tr>
<tr>
<td style='padding:24px 28px 28px 28px;'>
<a href='${href}' style='display:inline-block; background-color:#1B4F72; color:#ffffff; text-decoration:none; padding:12px 26px; border-radius:4px; font-size:14px; font-weight:bold;'>View incident</a>
</td>
</tr>
<tr>
<td style='padding:16px 28px; background-color:#f7fafb; border-top:1px solid #e3eaed;'>
<p style='margin:0; font-size:12px; color:#8a9aa3; line-height:1.5;'>You receive this because you are subscribed to <strong>${h.incident_type}</strong> notifications in AquaFix.<br>Automated message &mdash; please do not reply.</p>
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`;

  // EML-R06: plain-text part with the same facts and the link.
  const text = [
    `Hi ${v.to_name},`,
    "",
    `A new incident has been logged at ${v.location_name}.`,
    "",
    `Reference:     ${v.reference}`,
    `Incident type: ${v.incident_type}`,
    `Location:      ${v.location_name}`,
    `Logged by:     ${v.logged_by}`,
    `Logged at:     ${v.logged_at}`,
    "",
    "Description:",
    v.description,
    "",
    `View incident: ${values.incident_url || EMPTY}`,
    "",
    `You receive this because you are subscribed to ${v.incident_type} notifications in AquaFix.`,
    "Automated message — please do not reply.",
  ].join("\n");

  return { subject, html, text };
}
