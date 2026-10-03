import "server-only";

// Read-only client for the legacy system's OData services (Mendix, OData v4).
// Configure with ODATA_BASE_URL (e.g. https://host/odata), ODATA_USERNAME and
// ODATA_PASSWORD — server-side env only.

export type ODataRow = Record<string, unknown>;

export function odataConfigured(): boolean {
  return Boolean(process.env.ODATA_BASE_URL && process.env.ODATA_USERNAME && process.env.ODATA_PASSWORD);
}

// Mendix object IDs are 64-bit and exceed Number.MAX_SAFE_INTEGER, so they
// must never go through JSON.parse as numbers. Quote every ID / *ID value.
function quoteIds(text: string): string {
  return text.replace(/("(?:ID|[A-Za-z_]*ID)"\s*:\s*)(\d+)/g, '$1"$2"');
}

export async function fetchCollection(service: string, collection: string): Promise<ODataRow[]> {
  const base = process.env.ODATA_BASE_URL!.replace(/\/+$/, "");
  const auth = Buffer.from(`${process.env.ODATA_USERNAME}:${process.env.ODATA_PASSWORD}`).toString("base64");

  const rows: ODataRow[] = [];
  let url: string | null = `${base}/${service}/v1/${collection}`;
  while (url) {
    const res: Response = await fetch(url, {
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error("The OData service rejected the credentials.");
    }
    if (!res.ok) throw new Error(`${service}/${collection}: OData returned HTTP ${res.status}.`);
    const body = JSON.parse(quoteIds(await res.text())) as { value?: ODataRow[]; "@odata.nextLink"?: string };
    rows.push(...(body.value ?? []));
    url = body["@odata.nextLink"] ?? null;
  }
  return rows;
}
