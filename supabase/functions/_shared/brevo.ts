// Brevo transactional email API (EML-R09, R10) and key check (SET-R04).
// The api-key header is never logged or echoed back (EML-R13).

const BREVO_API = "https://api.brevo.com/v3";
// EML-R10: 15 s, not Mendix's 300 s.
const TIMEOUT_MS = 15_000;

export type EmailConfig = {
  email_enabled: boolean;
  api_key: string | null;
  sender_name: string;
  sender_email: string | null;
  reply_to_email: string | null;
  app_url: string | null;
  time_zone: string;
};

export type BrevoEmail = {
  to: { email: string; name: string };
  subject: string;
  html: string;
  text: string;
  tags: string[];
};

export type SendResult = {
  // 'retry' = 429, 5xx or a network error/timeout; 'failed' = don't retry.
  outcome: "sent" | "retry" | "failed";
  httpStatus: number | null;
  messageId: string | null;
  responseBody: string | null;
  errorReason: string | null;
};

function brevoMessage(body: string): string | null {
  try {
    const parsed = JSON.parse(body);
    return typeof parsed?.message === "string" ? parsed.message : null;
  } catch {
    return null;
  }
}

function networkReason(e: unknown): string {
  if (e instanceof DOMException && (e.name === "TimeoutError" || e.name === "AbortError")) {
    return "Brevo did not answer within 15 seconds";
  }
  return "Could not reach Brevo";
}

export async function sendBrevoEmail(config: EmailConfig, email: BrevoEmail): Promise<SendResult> {
  // Built with a JSON serialiser, never concatenation (fixes E3).
  const payload: Record<string, unknown> = {
    sender: { name: config.sender_name, email: config.sender_email },
    to: [email.to],
    subject: email.subject,
    htmlContent: email.html,
    textContent: email.text,
    tags: email.tags,
  };
  if (config.reply_to_email) payload.replyTo = { email: config.reply_to_email };

  let res: Response;
  try {
    res = await fetch(`${BREVO_API}/smtp/email`, {
      method: "POST",
      headers: {
        "api-key": config.api_key ?? "",
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return {
      outcome: "retry",
      httpStatus: null,
      messageId: null,
      responseBody: null,
      errorReason: networkReason(e),
    };
  }

  const body = await res.text().catch(() => "");
  if (res.ok) {
    let messageId: string | null = null;
    try {
      messageId = JSON.parse(body)?.messageId ?? null;
    } catch {
      // A 2xx without JSON still means Brevo accepted it.
    }
    return { outcome: "sent", httpStatus: res.status, messageId, responseBody: body, errorReason: null };
  }

  const retry = res.status === 429 || res.status >= 500;
  return {
    outcome: retry ? "retry" : "failed",
    httpStatus: res.status,
    messageId: null,
    responseBody: body,
    errorReason: brevoMessage(body) ?? `HTTP ${res.status}`,
  };
}

export type KeyCheck = {
  status: "valid" | "invalid" | "unknown";
  account: string | null;
  message: string | null;
};

// SET-R04: GET /v3/account. 200 → valid (with the account's company name or
// email), 401 → invalid, anything else → unknown.
export async function checkBrevoKey(apiKey: string): Promise<KeyCheck> {
  let res: Response;
  try {
    res = await fetch(`${BREVO_API}/account`, {
      headers: { "api-key": apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return { status: "unknown", account: null, message: networkReason(e) };
  }
  const body = await res.text().catch(() => "");
  if (res.status === 200) {
    try {
      const account = JSON.parse(body);
      return {
        status: "valid",
        account: account?.companyName || account?.email || null,
        message: null,
      };
    } catch {
      return { status: "valid", account: null, message: null };
    }
  }
  if (res.status === 401) {
    return { status: "invalid", account: null, message: brevoMessage(body) ?? "Key rejected by Brevo" };
  }
  return { status: "unknown", account: null, message: brevoMessage(body) ?? `HTTP ${res.status}` };
}
