import "server-only";

// Read-only client for the legacy system's OData services (Mendix, OData v4).
// Configure with ODATA_BASE_URL (e.g. https://host/odata), ODATA_USERNAME and
// ODATA_PASSWORD — server-side env only.

export type ODataRow = Record<string, unknown>;

export function odataConfigured(): boolean {
  return Boolean(process.env.ODATA_BASE_URL && process.env.ODATA_USERNAME && process.env.ODATA_PASSWORD);
}

// Mendix object IDs are 64-bit and exceed Number.MAX_SAFE_INTEGER, so they
// must never go through JSON.parse as numbers. Quote every integer too large
// to be exact (16+ digits), whatever its property name.
function quoteIds(text: string): string {
  return text.replace(/("[^"]+"\s*:\s*)(\d{16,})(?![\d.eE])/g, '$1"$2"');
}

class ODataResponseError extends Error {}

const RETRY_DELAYS_MS = [1_000, 3_000, 8_000];
const RETRY_STATUS = new Set([429, 502, 503, 504]);

function serviceUrl(service: string, path: string): string {
  return `${process.env.ODATA_BASE_URL!.replace(/\/+$/, "")}/${service}/v1/${path}`;
}

// The legacy host drops connections now and then ("other side closed"), so
// network errors and gateway responses are retried. `timeoutMs` guards the
// image requests, which run under a tight time budget.
async function request(url: string, what: string, accept: string, timeoutMs?: number): Promise<string> {
  const auth = Buffer.from(`${process.env.ODATA_USERNAME}:${process.env.ODATA_PASSWORD}`).toString("base64");
  for (let attempt = 0; ; attempt++) {
    const retry = attempt < RETRY_DELAYS_MS.length;
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Basic ${auth}`, Accept: accept },
        cache: "no-store",
        signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
      });
      if (res.status === 401 || res.status === 403) {
        throw new ODataResponseError("The OData service rejected the credentials.");
      }
      if (res.ok) return await res.text();
      if (!retry || !RETRY_STATUS.has(res.status)) {
        throw new ODataResponseError(`${what}: OData returned HTTP ${res.status}.`);
      }
    } catch (e) {
      if (e instanceof ODataResponseError) throw e;
      if (!retry) throw new Error(`${what}: could not reach the OData service (${(e as Error).message}).`);
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
  }
}

type ODataPage = { value?: ODataRow[]; "@odata.nextLink"?: string };

const parse = <T>(text: string) => JSON.parse(quoteIds(text)) as T;

export async function fetchCollection(service: string, collection: string): Promise<ODataRow[]> {
  const what = `${service}/${collection}`;
  const rows: ODataRow[] = [];
  let url: string | null = serviceUrl(service, collection);
  while (url) {
    const body: ODataPage = parse(await request(url, what, "application/json"));
    rows.push(...(body.value ?? []));
    url = body["@odata.nextLink"] ?? null;
  }
  return rows;
}

// One server-sized page, for feeds too big to hold in memory or read within a
// single run. `skip` counts the rows already read, ordered by ID so it stays
// valid between runs; `done` is true on the last page.
export async function fetchPage(
  service: string,
  collection: string,
  select: string,
  skip: number,
  timeoutMs: number,
): Promise<{ rows: ODataRow[]; done: boolean }> {
  const url = serviceUrl(service, `${collection}?$select=${select}&$orderby=ID&$skip=${skip}`);
  const body = parse<ODataPage>(await request(url, `${service}/${collection}`, "application/json", timeoutMs));
  const rows = body.value ?? [];
  return { rows, done: rows.length === 0 || !body["@odata.nextLink"] };
}

export async function fetchRow(
  service: string,
  collection: string,
  id: string,
  select: string,
  timeoutMs: number,
): Promise<ODataRow> {
  const url = serviceUrl(service, `${collection}(${id})?$select=${select}`);
  return parse<ODataRow>(await request(url, `${service}/${collection}`, "application/json", timeoutMs));
}

export async function fetchCount(service: string, collection: string, timeoutMs: number): Promise<number> {
  const url = serviceUrl(service, `${collection}/$count`);
  return Number(await request(url, `${service}/${collection}`, "text/plain", timeoutMs));
}
