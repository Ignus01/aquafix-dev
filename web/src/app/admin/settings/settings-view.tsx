"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { formatDateTime } from "@/lib/incidents/format";
import type {
  BrevoKeyStatus,
  EmailLogRow,
  EmailLogStatus,
  KeyCheckResult,
  SettingsAuditRow,
  SettingsForm,
  SystemSettings,
} from "@/lib/settings/types";
import { Modal } from "../modal";
import {
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  sectionHeadingClass,
  tableHeadCellClass,
} from "../ui";
import {
  removeApiKey,
  resendEmail,
  saveSettings,
  sendTestEmail,
  setApiKey,
  testConnection,
} from "./actions";

type Notice = { tone: "success" | "danger" | "muted"; text: string } | null;

const toneClass = {
  success: "border-success text-success",
  danger: "border-danger text-danger",
  muted: "border-border text-muted",
};

function NoticeLine({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return <p className={`border-l-2 py-1 pl-3 text-[13px] ${toneClass[notice.tone]}`}>{notice.text}</p>;
}

function Pill({ tone, children }: { tone: "success" | "danger" | "warning" | "muted"; children: React.ReactNode }) {
  const styles = {
    success: "bg-success-bg text-success",
    danger: "bg-danger-bg text-danger",
    warning: "bg-warning-bg text-warning",
    muted: "bg-black/[.04] text-muted",
  }[tone];
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${styles}`}>
      {children}
    </span>
  );
}

const KEY_STATUS: Record<BrevoKeyStatus, { tone: "success" | "danger" | "warning" | "muted"; label: string }> = {
  valid: { tone: "success", label: "✔ Valid" },
  invalid: { tone: "danger", label: "Key invalid" },
  unknown: { tone: "warning", label: "Not checked" },
  not_configured: { tone: "muted", label: "Not configured" },
};

const LOG_STATUS: Record<EmailLogStatus, "success" | "danger" | "warning" | "muted"> = {
  sent: "success",
  failed: "danger",
  retrying: "warning",
  skipped: "muted",
};

function keyCheckNotice(check: KeyCheckResult): Notice {
  if (check.status === "valid") {
    return { tone: "success", text: `Key is valid${check.account ? ` — ${check.account}` : ""}.` };
  }
  if (check.status === "invalid") {
    return { tone: "danger", text: `Brevo rejected the key${check.message ? `: ${check.message}` : ""}.` };
  }
  return {
    tone: "muted",
    text: `Couldn't confirm the key with Brevo${check.message ? ` (${check.message})` : ""}. Try "Test connection" later.`,
  };
}

const AUDIT_LABELS: Record<string, string> = {
  brevo_api_key: "Brevo API key",
  email_enabled: "Notifications enabled",
  sender_name: "Sender name",
  sender_email: "Sender email",
  reply_to_email: "Reply-to email",
  app_url: "App URL",
  time_zone: "Time zone",
  vat_rate: "VAT rate",
};

export function SettingsView({
  settings,
  emailLog,
  audit,
}: {
  settings: SystemSettings;
  emailLog: EmailLogRow[];
  audit: SettingsAuditRow[];
}) {
  const tz = settings.time_zone;
  const [form, setForm] = useState<SettingsForm>({
    email_enabled: settings.email_enabled,
    sender_name: settings.sender_name,
    sender_email: settings.sender_email ?? "",
    reply_to_email: settings.reply_to_email ?? "",
    app_url: settings.app_url ?? "",
    time_zone: settings.time_zone,
    // SET-R11: shown as a percentage, stored as a fraction.
    vat_percent: String(Math.round(settings.vat_rate * 10000) / 100),
  });
  const [saveNotice, setSaveNotice] = useState<Notice>(null);
  const [vatNotice, setVatNotice] = useState<Notice>(null);
  const [keyNotice, setKeyNotice] = useState<Notice>(null);
  const [testNotice, setTestNotice] = useState<Notice>(null);
  const [keyModal, setKeyModal] = useState(false);
  const [isPending, startTransition] = useTransition();

  const set = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // SET-R08: the toggle only turns on when everything it needs is set.
  const missing = [
    !settings.has_key && "a Brevo API key",
    !form.sender_email.trim() && "a sender email",
    !form.app_url.trim() && "an App URL",
  ].filter(Boolean) as string[];
  const canEnable = missing.length === 0;

  const timeZones = useMemo(() => {
    const zones = Intl.supportedValuesOf("timeZone");
    return zones.includes(form.time_zone) ? zones : [form.time_zone, ...zones];
  }, [form.time_zone]);

  function save(target: "email" | "vat") {
    const setNotice = target === "email" ? setSaveNotice : setVatNotice;
    setNotice(null);
    startTransition(async () => {
      const res = await saveSettings({ ...form, email_enabled: form.email_enabled && canEnable });
      setNotice(res.error ? { tone: "danger", text: res.error } : { tone: "success", text: "Saved." });
    });
  }

  function runTestConnection() {
    setKeyNotice(null);
    startTransition(async () => {
      const res = await testConnection();
      setKeyNotice(res.error ? { tone: "danger", text: res.error } : res.check ? keyCheckNotice(res.check) : null);
    });
  }

  function runRemoveKey() {
    if (!confirm("Email notifications will stop until a new key is added.")) return;
    setKeyNotice(null);
    startTransition(async () => {
      const res = await removeApiKey();
      if (res.error) setKeyNotice({ tone: "danger", text: res.error });
      else {
        set("email_enabled", false);
        setKeyNotice({ tone: "muted", text: "Key removed. Notifications are off." });
      }
    });
  }

  function runSendTest() {
    setTestNotice(null);
    startTransition(async () => {
      const res = await sendTestEmail();
      setTestNotice(
        res.error
          ? { tone: "danger", text: res.error }
          : {
              tone: "success",
              text: `Sent to ${res.recipient}${res.messageId ? ` — Brevo message ID ${res.messageId}` : ""}.`,
            },
      );
    });
  }

  const keyStatus = KEY_STATUS[settings.brevo_key_status];

  return (
    <div className="flex flex-col gap-6 px-4 pb-10 md:px-8">
      {/* ------------------------------------------------------------------ */}
      <section className="rounded-card border border-border bg-card">
        <div className="border-b border-border px-5 py-4 md:px-6">
          <h2 className={sectionHeadingClass}>Email notifications (Brevo)</h2>
          <p className="mt-1 text-[13px] text-muted">
            When an incident is logged, everyone subscribed to its incident type is emailed.
          </p>
        </div>

        <div className="flex flex-col gap-6 px-5 py-5 md:px-6">
          <div className="grid gap-2 sm:grid-cols-[180px_1fr] sm:items-center">
            <span className={labelClass}>Notifications enabled</span>
            <div className="flex flex-col gap-1">
              <div
                className="flex gap-4"
                title={canEnable ? undefined : `Needs ${missing.join(", ")}.`}
              >
                {[
                  [true, "On"],
                  [false, "Off"],
                ].map(([value, label]) => (
                  <label
                    key={String(value)}
                    className={`flex items-center gap-2 text-sm ${
                      value && !canEnable ? "text-muted" : "text-ink"
                    }`}
                  >
                    <input
                      type="radio"
                      name="email_enabled"
                      checked={form.email_enabled === value && (!value || canEnable)}
                      disabled={Boolean(value) && !canEnable}
                      onChange={() => set("email_enabled", Boolean(value))}
                      className="accent-primary"
                    />
                    {label}
                  </label>
                ))}
              </div>
              {!canEnable && (
                <span className="text-xs text-muted">Needs {missing.join(", ")} before it can be turned on.</span>
              )}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-[180px_1fr]">
            <span className={`${labelClass} sm:pt-1`}>Brevo API key</span>
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-3">
                {settings.has_key ? (
                  <span className="font-mono text-sm text-ink">
                    ●●●●●●●●●●●● …{settings.brevo_key_last4}
                  </span>
                ) : (
                  <span className="text-sm text-muted">No key configured</span>
                )}
                <Pill tone={keyStatus.tone}>
                  {keyStatus.label}
                  {settings.brevo_key_checked_at && settings.brevo_key_status !== "not_configured" && (
                    <span className="ml-1 font-normal">
                      · checked {formatDateTime(settings.brevo_key_checked_at, tz)}
                    </span>
                  )}
                </Pill>
                {settings.brevo_key_status === "valid" && settings.brevo_key_account && (
                  <span className="text-[13px] text-muted">{settings.brevo_key_account}</span>
                )}
              </div>
              {settings.brevo_key_status === "invalid" && (
                <p className="rounded-control bg-danger-bg px-3 py-2 text-[13px] text-danger">
                  Brevo rejects this key, so no emails can be sent. Replace it with a valid API v3 key.
                </p>
              )}
              {settings.brevo_key_changed_at && (
                <span className="text-xs text-muted">
                  Last changed {formatDateTime(settings.brevo_key_changed_at, tz)}
                  {settings.brevo_key_changed_by_name && ` by ${settings.brevo_key_changed_by_name}`}
                </span>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => {
                    setKeyNotice(null);
                    setKeyModal(true);
                  }}
                  className={secondaryButtonClass}
                >
                  {settings.has_key ? "Replace key" : "Add key"}
                </button>
                {settings.has_key && (
                  <>
                    <button type="button" disabled={isPending} onClick={runTestConnection} className={secondaryButtonClass}>
                      Test connection
                    </button>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={runRemoveKey}
                      className="h-[40px] rounded-control border border-danger/30 bg-white px-4 text-sm font-medium text-danger transition-colors hover:bg-danger-bg disabled:opacity-60"
                    >
                      Remove key
                    </button>
                  </>
                )}
              </div>
              <NoticeLine notice={keyNotice} />
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-[180px_1fr] sm:items-center">
            <label htmlFor="sender_name" className={labelClass}>Sender name</label>
            <input
              id="sender_name"
              className={`${inputClass} max-w-md`}
              value={form.sender_name}
              onChange={(e) => set("sender_name", e.target.value)}
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-[180px_1fr]">
            <label htmlFor="sender_email" className={`${labelClass} sm:pt-3`}>Sender email</label>
            <div className="flex flex-col gap-1">
              <input
                id="sender_email"
                type="email"
                className={`${inputClass} max-w-md`}
                value={form.sender_email}
                onChange={(e) => set("sender_email", e.target.value)}
                placeholder="notifications@example.com"
              />
              <span className="text-xs text-muted">Must be a sender or domain verified in your Brevo account.</span>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-[180px_1fr] sm:items-center">
            <label htmlFor="reply_to_email" className={labelClass}>Reply-to email</label>
            <input
              id="reply_to_email"
              type="email"
              className={`${inputClass} max-w-md`}
              value={form.reply_to_email}
              onChange={(e) => set("reply_to_email", e.target.value)}
              placeholder="Optional"
            />
          </div>

          <div className="grid gap-2 sm:grid-cols-[180px_1fr]">
            <label htmlFor="app_url" className={`${labelClass} sm:pt-3`}>App URL</label>
            <div className="flex flex-col gap-1">
              <input
                id="app_url"
                type="url"
                className={`${inputClass} max-w-md`}
                value={form.app_url}
                onChange={(e) => set("app_url", e.target.value)}
                placeholder="https://aquafix.example.com"
              />
              <span className="text-xs text-muted">
                Used for the &ldquo;View incident&rdquo; link: {(form.app_url.trim().replace(/\/+$/, "") || "https://…")}/incidents/1042
              </span>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-[180px_1fr] sm:items-center">
            <label htmlFor="time_zone" className={labelClass}>Time zone</label>
            <select
              id="time_zone"
              className={`${inputClass} max-w-md`}
              value={form.time_zone}
              onChange={(e) => set("time_zone", e.target.value)}
            >
              {timeZones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </div>

          <NoticeLine notice={saveNotice} />
          <NoticeLine notice={testNotice} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-4 md:px-6">
          <button
            type="button"
            disabled={isPending || !settings.has_key}
            onClick={runSendTest}
            title={settings.has_key ? "Uses the saved settings" : "Add a Brevo API key first"}
            className={secondaryButtonClass}
          >
            Send test email to me
          </button>
          <button type="button" disabled={isPending} onClick={() => save("email")} className={primaryButtonClass}>
            {isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      <section className="rounded-card border border-border bg-card">
        <div className="border-b border-border px-5 py-4 md:px-6">
          <h2 className={sectionHeadingClass}>Stock</h2>
        </div>
        <div className="flex flex-col gap-4 px-5 py-5 md:px-6">
          <div className="grid gap-2 sm:grid-cols-[180px_1fr]">
            <label htmlFor="vat_percent" className={`${labelClass} sm:pt-3`}>VAT percentage</label>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <input
                  id="vat_percent"
                  type="number"
                  min={0}
                  max={100}
                  step={0.01}
                  className={`${inputClass} max-w-[120px]`}
                  value={form.vat_percent}
                  onChange={(e) => set("vat_percent", e.target.value)}
                />
                <span className="text-sm text-muted">%</span>
              </div>
              <span className="text-xs text-muted">Applies to prices calculated after the change.</span>
            </div>
          </div>
          <NoticeLine notice={vatNotice} />
        </div>
        <div className="flex justify-end border-t border-border px-5 py-4 md:px-6">
          <button type="button" disabled={isPending} onClick={() => save("vat")} className={primaryButtonClass}>
            {isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </section>

      <EmailLog rows={emailLog} timeZone={tz} />

      {audit.length > 0 && (
        <section className="rounded-card border border-border bg-card">
          <div className="border-b border-border px-5 py-4 md:px-6">
            <h2 className={sectionHeadingClass}>Recent changes</h2>
          </div>
          <ul className="flex flex-col divide-y divide-border">
            {audit.map((a) => (
              <li key={a.id} className="flex flex-wrap gap-x-3 gap-y-0.5 px-5 py-2.5 text-[13px] md:px-6">
                <span className="font-medium text-ink">
                  {AUDIT_LABELS[a.field] ?? a.field}
                  {a.field === "brevo_api_key"
                    ? ` ${a.new_value?.replace(/^key /, "")}`
                    : `: ${a.old_value ?? "—"} → ${a.new_value ?? "—"}`}
                </span>
                <span className="text-muted">
                  {formatDateTime(a.changed_at, tz)}
                  {a.changed_by_name && ` by ${a.changed_by_name}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {keyModal && <ReplaceKeyModal onClose={() => setKeyModal(false)} onSaved={setKeyNotice} />}
    </div>
  );
}

// SET-R02/R03: a password-type input, sent once to the server and cleared.
function ReplaceKeyModal({ onClose, onSaved }: { onClose: () => void; onSaved: (n: Notice) => void }) {
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setError(null);
    const value = key.trim();
    if (!value) {
      setError("Enter the API key.");
      return;
    }
    startTransition(async () => {
      const res = await setApiKey(value);
      setKey("");
      if (res.error) {
        setError(res.error);
        return;
      }
      onSaved(res.check ? keyCheckNotice(res.check) : { tone: "muted", text: "Key saved." });
      onClose();
    });
  }

  return (
    <Modal
      open
      title="Brevo API key"
      onClose={onClose}
      footer={
        <>
          <button type="button" disabled={isPending} onClick={onClose} className={secondaryButtonClass}>
            Cancel
          </button>
          <button type="button" disabled={isPending} onClick={submit} className={primaryButtonClass}>
            {isPending ? "Saving…" : "Save key"}
          </button>
        </>
      }
    >
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor="brevo_key" className={labelClass}>API v3 key</label>
        <div className="flex gap-2">
          <input
            id="brevo_key"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            type={show ? "text" : "password"}
            className={`${inputClass} font-mono`}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="xkeysib-…"
          />
          <button type="button" onClick={() => setShow((v) => !v)} className={`${secondaryButtonClass} shrink-0`}>
            {show ? "Hide" : "Show"}
          </button>
        </div>
        <span className="text-xs text-muted">
          Once saved, the key can&apos;t be viewed again. It is checked with Brevo straight away.
        </span>
        {error && <span className="text-xs text-danger">{error}</span>}
      </form>
    </Modal>
  );
}

// Email log grid (EML-R11, R12). Failed notifications can be resent.
function EmailLog({ rows, timeZone }: { rows: EmailLogRow[]; timeZone: string }) {
  const [status, setStatus] = useState<EmailLogStatus | "">("");
  const [recipient, setRecipient] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = recipient.trim().toLowerCase();
    return rows.filter((r) => {
      if (status && r.status !== status) return false;
      if (q && !(r.recipient_email ?? "").includes(q)) return false;
      const day = r.created_at.slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      return true;
    });
  }, [rows, status, recipient, from, to]);

  function resend(row: EmailLogRow) {
    setError(null);
    startTransition(async () => {
      const res = await resendEmail(row.id);
      if (res.error) setError(res.error);
    });
  }

  return (
    <section className="rounded-card border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-border px-5 py-4 md:px-6">
        <h2 className={`${sectionHeadingClass} mr-auto`}>Email log</h2>
        <select
          aria-label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as EmailLogStatus | "")}
          className={`${inputClass} !h-[36px] !w-auto`}
        >
          <option value="">Any status</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
          <option value="retrying">Retrying</option>
          <option value="skipped">Skipped</option>
        </select>
        <input
          aria-label="Recipient"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="Recipient"
          className={`${inputClass} !h-[36px] !w-44`}
        />
        <input
          aria-label="From date"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className={`${inputClass} !h-[36px] !w-auto`}
        />
        <input
          aria-label="To date"
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className={`${inputClass} !h-[36px] !w-auto`}
        />
      </div>

      {error && <p className="mx-5 mt-3 border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">{error}</p>}

      {filtered.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted">
          {rows.length === 0 ? "No emails have been sent yet." : "No log entries match these filters."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-table-head">
                <th className={`${tableHeadCellClass} !px-5`}>Date</th>
                <th className={tableHeadCellClass}>Recipient</th>
                <th className={tableHeadCellClass}>Subject</th>
                <th className={tableHeadCellClass}>Status</th>
                <th className={tableHeadCellClass}>HTTP</th>
                <th className={tableHeadCellClass}>Message ID</th>
                <th className={tableHeadCellClass}>Error</th>
                <th className={tableHeadCellClass} />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className="px-5 py-2.5 whitespace-nowrap text-muted">{formatDateTime(r.created_at, timeZone)}</td>
                  <td className="px-3 py-2.5 text-ink">{r.recipient_email ?? "—"}</td>
                  <td className="px-3 py-2.5 text-ink">
                    {r.incident_reference ? (
                      <Link href={`/admin/incidents/${r.incident_reference}`} className="hover:text-primary">
                        {r.subject ?? "—"}
                      </Link>
                    ) : (
                      (r.subject ?? "—")
                    )}
                    {r.tag === "test" && <span className="ml-2"><Pill tone="muted">test</Pill></span>}
                  </td>
                  <td className="px-3 py-2.5">
                    <Pill tone={LOG_STATUS[r.status]}>
                      {r.status}
                      {r.attempt && r.attempt > 1 ? ` · try ${r.attempt}` : ""}
                    </Pill>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[13px] text-muted">{r.http_status ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    <span className="block max-w-[180px] truncate font-mono text-[12px] text-muted" title={r.brevo_message_id ?? undefined}>
                      {r.brevo_message_id ?? "—"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-[13px] text-muted">
                    <span title={r.response_body ?? undefined}>
                      {r.error_reason ?? "—"}
                      {r.status === "skipped" && r.response_body ? ` — ${r.response_body}` : ""}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {r.can_resend && (
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => resend(r)}
                        className="text-xs font-semibold text-primary hover:text-primary-hover disabled:opacity-60"
                      >
                        Resend
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
