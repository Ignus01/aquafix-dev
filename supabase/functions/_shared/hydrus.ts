// Hydrus logger API (KovcoLabs, hosted by Electrodev). All calls are GETs to
// retrieve.php and answer JSON `{ status: "success" | "failure", value }`.
//
//   method=params   → { measured_param (unit), location, latest_reading, … }
//   method=readings → [{ reading, reading_timestamp ("YYYY-MM-DD HH:MM:SS",
//                       SAST), rssi, gateway, mains, gsm, gateway_batt }, …]
//
// An unknown logger code answers 200 with an empty body rather than the
// documented "failure", so both count as rejected.

const BASE_URL = "https://www.electrodevsa.co.za/wm/api/retrieve.php";
const REQUEST_TIMEOUT_MS = 20_000;

export type HydrusReading = { reading: string; reading_timestamp: string };

export type HydrusResult =
  | { outcome: "success"; unit: string | null; readings: HydrusReading[]; httpStatus: number }
  | { outcome: "retry" | "failed"; httpStatus: number | null; error: string };

type Call =
  | { ok: true; value: unknown; httpStatus: number }
  | { ok: false; outcome: "retry" | "failed"; httpStatus: number | null; error: string };

const REJECTED = "Hydrus rejected the logger code or password.";

async function call(params: Record<string, string>): Promise<Call> {
  const url = `${BASE_URL}?${new URLSearchParams(params)}`;
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (e) {
    const timedOut = e instanceof DOMException && e.name === "TimeoutError";
    return { ok: false, outcome: "retry", httpStatus: null, error: timedOut ? "Hydrus did not answer in time." : "Could not reach Hydrus." };
  }

  const body = (await res.text().catch(() => "")).trim();
  if (res.status === 429 || res.status >= 500) {
    return { ok: false, outcome: "retry", httpStatus: res.status, error: `Hydrus answered HTTP ${res.status}.` };
  }
  if (!res.ok) {
    return { ok: false, outcome: "failed", httpStatus: res.status, error: `Hydrus answered HTTP ${res.status}.` };
  }
  if (body === "") return { ok: false, outcome: "failed", httpStatus: res.status, error: REJECTED };

  let parsed: { status?: unknown; value?: unknown };
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, outcome: "failed", httpStatus: res.status, error: "Hydrus sent a response that isn't JSON." };
  }
  if (parsed.status !== "success") return { ok: false, outcome: "failed", httpStatus: res.status, error: REJECTED };
  return { ok: true, value: parsed.value, httpStatus: res.status };
}

// The logger's unit, then its readings between two Unix timestamps.
export async function pullHydrus(
  loggerCode: string,
  password: string,
  start: number,
  end: number,
): Promise<HydrusResult> {
  const auth = { uid: loggerCode, pwd: password };

  const params = await call({ method: "params", ...auth });
  if (!params.ok) return { outcome: params.outcome, httpStatus: params.httpStatus, error: params.error };
  const unit = (params.value as { measured_param?: unknown } | null)?.measured_param;

  const readings = await call({ method: "readings", ...auth, start: String(start), end: String(end) });
  if (!readings.ok) return { outcome: readings.outcome, httpStatus: readings.httpStatus, error: readings.error };
  if (!Array.isArray(readings.value)) {
    return { outcome: "failed", httpStatus: readings.httpStatus, error: "Hydrus sent readings in an unexpected format." };
  }

  return {
    outcome: "success",
    unit: typeof unit === "string" && unit.trim() ? unit.trim() : null,
    readings: readings.value.map((r) => ({
      reading: String((r as Record<string, unknown>)?.reading ?? ""),
      reading_timestamp: String((r as Record<string, unknown>)?.reading_timestamp ?? ""),
    })),
    httpStatus: readings.httpStatus,
  };
}
