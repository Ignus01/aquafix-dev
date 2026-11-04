// The upload rule (spec "How uploadData() handles one transaction", step 4):
// retry only on no network, timeout, HTTP 5xx, 408, 429 and an expired
// session. Every other error is permanent and goes to Needs attention, so one
// bad save never blocks the ones behind it.

export type RpcFailure = {
  // HTTP status from PostgREST; 0 or undefined when the request never got an answer.
  status?: number;
  code?: string;
  message?: string;
};

export type Classified = { kind: "transient" } | { kind: "permanent"; code: string; message: string };

// PostgREST's JWT errors: the access token expired or was rejected. The
// connector refreshes the session and the transaction is retried.
const JWT_CODES = new Set(["PGRST301", "PGRST302", "PGRST303"]);

export function classifyRpcFailure(f: RpcFailure): Classified {
  const status = f.status ?? 0;
  const code = f.code ?? "";
  if (status === 0) return { kind: "transient" };
  if (status === 408 || status === 429 || status >= 500) return { kind: "transient" };
  if (JWT_CODES.has(code)) return { kind: "transient" };
  if (status === 401 && /jwt/i.test(f.message ?? "")) return { kind: "transient" };
  return { kind: "permanent", code: code || `HTTP ${status}`, message: f.message || "The server refused this save." };
}

// A thrown error (fetch failed, aborted, timed out) is always transient.
export function isNetworkError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  return /network|fetch|timeout|timed out|abort|offline|connection/i.test(`${e.name} ${e.message}`);
}

// Storage upload results: 409 / "Duplicate" / "already exists" at our fixed
// path means an earlier attempt got there; count it as uploaded.
export function isAlreadyUploaded(e: { statusCode?: string | number; status?: number; message?: string; error?: string } | null): boolean {
  if (!e) return false;
  const status = Number(e.statusCode ?? e.status ?? 0);
  return status === 409 || /duplicate|already exists/i.test(`${e.error ?? ""} ${e.message ?? ""}`);
}

export function isTransientStorageError(e: { statusCode?: string | number; status?: number; message?: string } | null): boolean {
  if (!e) return false;
  const status = Number(e.statusCode ?? e.status ?? 0);
  if (status === 0 || status === 408 || status === 429 || status >= 500) return true;
  return /network|fetch|timeout/i.test(e.message ?? "");
}
