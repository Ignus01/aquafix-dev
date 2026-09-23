export type BrevoKeyStatus = "not_configured" | "valid" | "invalid" | "unknown";

// system_settings as the settings page sees it. The key itself is never
// sent to the browser (SET-R02) — only whether one is set and its last 4.
export type SystemSettings = {
  email_enabled: boolean;
  has_key: boolean;
  brevo_key_last4: string | null;
  brevo_key_status: BrevoKeyStatus;
  brevo_key_checked_at: string | null;
  brevo_key_account: string | null;
  brevo_key_changed_at: string | null;
  brevo_key_changed_by_name: string | null;
  sender_name: string;
  sender_email: string | null;
  reply_to_email: string | null;
  app_url: string | null;
  time_zone: string;
  vat_rate: number;
};

export type SettingsForm = {
  email_enabled: boolean;
  sender_name: string;
  sender_email: string;
  reply_to_email: string;
  app_url: string;
  time_zone: string;
  vat_percent: string;
};

export type EmailLogStatus = "sent" | "failed" | "retrying" | "skipped";

export type EmailLogRow = {
  id: number;
  created_at: string;
  tag: string;
  recipient_email: string | null;
  subject: string | null;
  status: EmailLogStatus;
  attempt: number | null;
  http_status: number | null;
  brevo_message_id: string | null;
  error_reason: string | null;
  response_body: string | null;
  incident_reference: number | null;
  // The latest attempt for its outbox row, and that attempt failed (EML-R12).
  can_resend: boolean;
};

export type SettingsAuditRow = {
  id: number;
  changed_at: string;
  changed_by_name: string | null;
  field: string;
  old_value: string | null;
  new_value: string | null;
};

export type KeyCheckResult = {
  status: BrevoKeyStatus;
  account: string | null;
  message: string | null;
};
