import "server-only";
import { Document, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import sharp from "sharp";
import { formatDay } from "@/lib/dashboard/format";
import { formatDate, formatDateTime } from "@/lib/incidents/format";
import type { createClient } from "@/lib/supabase/server";
import { formatMoney, formatQty, formatRate, num } from "./format";
import { METER_UNIT, billingMeterLabel, type InvoiceLine, type InvoiceRow } from "./types";

// Invoice PDFs, rendered on request from the invoice snapshot (an approved
// invoice never changes, so the PDF doesn't either). Drafts render with a
// DRAFT banner for checking.

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Photo = { data: Buffer; format: "jpg" };
type PdfInvoice = {
  invoice: InvoiceRow;
  lines: (InvoiceLine & { prevPhoto: Photo | null; currPhoto: Photo | null })[];
};

const IMAGE_BUCKET = "inspection-images";
const INVOICE_COLUMNS =
  "id, billing_run_id, location_id, location_name, organisation_name, region_name, status, invoice_no, billing_day, " +
  "period_start, period_end, tariff_rate, treated_usage, amount, issues, generated_at, approved_at, approved_by, " +
  "voided_at, void_reason";

// Downloads and shrinks a meter photo; null when it can't be read.
async function loadPhoto(supabase: Supabase, path: string | null): Promise<Photo | null> {
  if (!path) return null;
  try {
    const { data, error } = await supabase.storage.from(IMAGE_BUCKET).download(path);
    if (error || !data) return null;
    const input = Buffer.from(await data.arrayBuffer());
    const out = await sharp(input).rotate().resize(700, 700, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer();
    return { data: out, format: "jpg" };
  } catch {
    return null;
  }
}

// Invoices with their lines and photos, in the given order (RLS applies).
export async function loadPdfInvoices(supabase: Supabase, ids: string[]): Promise<PdfInvoice[]> {
  if (ids.length === 0) return [];
  const { data: invoices, error } = await supabase.from("invoice").select(INVOICE_COLUMNS).in("id", ids);
  if (error) throw error;
  const { data: lineRows, error: lineError } = await supabase
    .from("invoice_line")
    .select("*")
    .in("invoice_id", ids)
    .order("sort_order");
  if (lineError) throw lineError;

  const lines = (lineRows ?? []).map((r) => ({
    ...(r as InvoiceLine),
    prev_value: num(r.prev_value),
    curr_value: num(r.curr_value),
    usage: num(r.usage),
  }));
  const paths = [...new Set(lines.flatMap((l) => [l.prev_image_path, l.curr_image_path]).filter((p): p is string => !!p))];
  const photos = new Map<string, Photo | null>();
  // A few at a time, to keep memory and Storage requests in check.
  for (let i = 0; i < paths.length; i += 6) {
    const batch = paths.slice(i, i + 6);
    const loaded = await Promise.all(batch.map((p) => loadPhoto(supabase, p)));
    batch.forEach((p, j) => photos.set(p, loaded[j]));
  }

  const byId = new Map(
    ((invoices ?? []) as unknown as Record<string, unknown>[]).map((r) => [
      r.id as string,
      { ...(r as unknown as InvoiceRow), tariff_rate: num(r.tariff_rate), treated_usage: num(r.treated_usage), amount: num(r.amount) },
    ]),
  );
  return ids
    .filter((id) => byId.has(id))
    .map((id) => ({
      invoice: byId.get(id)!,
      lines: lines
        .filter((l) => l.invoice_id === id)
        .map((l) => ({
          ...l,
          prevPhoto: l.prev_image_path ? (photos.get(l.prev_image_path) ?? null) : null,
          currPhoto: l.curr_image_path ? (photos.get(l.curr_image_path) ?? null) : null,
        })),
    }));
}

const INK = "#141a33";
const MUTED = "#5b6480";
const BORDER = "#dde2ec";
const PRIMARY = "#0b6e86";

const s = StyleSheet.create({
  page: { padding: 36, fontSize: 9, color: INK, fontFamily: "Helvetica" },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 18 },
  brand: { fontSize: 16, fontFamily: "Helvetica-Bold", color: PRIMARY },
  title: { fontSize: 20, fontFamily: "Helvetica-Bold", textAlign: "right" },
  draft: { fontSize: 20, fontFamily: "Helvetica-Bold", textAlign: "right", color: "#b42318" },
  muted: { color: MUTED },
  metaRow: { flexDirection: "row", justifyContent: "flex-end", gap: 6, marginTop: 2 },
  boxRow: { flexDirection: "row", gap: 12, marginBottom: 16 },
  box: { flex: 1, borderWidth: 1, borderColor: BORDER, borderRadius: 4, padding: 10 },
  label: { fontSize: 7, color: MUTED, textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 3 },
  strong: { fontFamily: "Helvetica-Bold" },
  big: { fontSize: 12, fontFamily: "Helvetica-Bold" },
  table: { borderWidth: 1, borderColor: BORDER, borderRadius: 4, marginBottom: 16 },
  th: { flexDirection: "row", backgroundColor: "#f7f9fc", borderBottomWidth: 1, borderColor: BORDER },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderColor: BORDER },
  trLast: { flexDirection: "row" },
  cell: { padding: 6 },
  right: { textAlign: "right" },
  section: { fontSize: 10, fontFamily: "Helvetica-Bold", marginBottom: 6 },
  photoRow: { flexDirection: "row", gap: 12, marginBottom: 12 },
  photoBox: { flex: 1, borderWidth: 1, borderColor: BORDER, borderRadius: 4, padding: 6 },
  photo: { height: 180, objectFit: "contain", marginBottom: 4 },
  noPhoto: { height: 180, backgroundColor: "#f7f9fc", justifyContent: "center", alignItems: "center", marginBottom: 4 },
  footer: { position: "absolute", bottom: 20, left: 36, right: 36, fontSize: 7, color: MUTED, flexDirection: "row", justifyContent: "space-between" },
});

const col = { meter: "28%", type: "14%", open: "20%", close: "20%", usage: "18%" };

function InvoicePages({ data, timeZone }: { data: PdfInvoice; timeZone: string }) {
  const { invoice: inv, lines } = data;
  const isDraft = inv.status !== "approved";
  const treated = lines.filter((l) => l.meter === "treated");
  const readingText = (value: number | null, at: string | null, source: string) =>
    value === null ? "—" : `${formatQty(value)}${at ? `\n${formatDateTime(at, timeZone)}` : source === "manual" ? "\n(typed)" : ""}`;

  return (
    <Page size="A4" style={s.page}>
      <View style={s.header}>
        <View>
          <Text style={s.brand}>AquaFix</Text>
          <Text style={s.muted}>Water supply invoice</Text>
        </View>
        <View>
          <Text style={isDraft ? s.draft : s.title}>{inv.status === "void" ? "VOID" : isDraft ? "DRAFT" : "INVOICE"}</Text>
          <View style={s.metaRow}>
            <Text style={s.muted}>Invoice no</Text>
            <Text style={s.strong}>{inv.invoice_no ?? "—"}</Text>
          </View>
          <View style={s.metaRow}>
            <Text style={s.muted}>Date</Text>
            <Text>{inv.approved_at ? formatDate(inv.approved_at, timeZone) : formatDate(inv.generated_at, timeZone)}</Text>
          </View>
        </View>
      </View>

      <View style={s.boxRow}>
        <View style={s.box}>
          <Text style={s.label}>Location</Text>
          <Text style={s.big}>{inv.location_name}</Text>
          {inv.organisation_name && <Text>{inv.organisation_name}</Text>}
          {inv.region_name && <Text style={s.muted}>{inv.region_name}</Text>}
        </View>
        <View style={s.box}>
          <Text style={s.label}>Billing period</Text>
          <Text style={s.big}>
            {formatDay(inv.period_start)} – {formatDay(inv.period_end)}
          </Text>
          <Text style={s.muted}>Readings taken on day {inv.billing_day === 31 ? "end of month" : inv.billing_day}</Text>
        </View>
      </View>

      <View style={s.table}>
        <View style={s.th}>
          <Text style={[s.cell, { width: "46%" }, s.strong]}>Description</Text>
          <Text style={[s.cell, { width: "18%" }, s.right, s.strong]}>Quantity (kL)</Text>
          <Text style={[s.cell, { width: "18%" }, s.right, s.strong]}>Rate</Text>
          <Text style={[s.cell, { width: "18%" }, s.right, s.strong]}>Amount</Text>
        </View>
        <View style={s.tr}>
          <Text style={[s.cell, { width: "46%" }]}>
            Treated water supplied{treated.length > 1 ? ` (${treated.length} meters)` : ""}
          </Text>
          <Text style={[s.cell, { width: "18%" }, s.right]}>{formatQty(inv.treated_usage)}</Text>
          <Text style={[s.cell, { width: "18%" }, s.right]}>{formatRate(inv.tariff_rate)}</Text>
          <Text style={[s.cell, { width: "18%" }, s.right]}>{formatMoney(inv.amount)}</Text>
        </View>
        <View style={s.trLast}>
          <Text style={[s.cell, { width: "82%" }, s.right, s.strong]}>Total</Text>
          <Text style={[s.cell, { width: "18%" }, s.right, s.big]}>{formatMoney(inv.amount)}</Text>
        </View>
      </View>

      <Text style={s.section}>Meter readings</Text>
      <View style={s.table}>
        <View style={s.th}>
          <Text style={[s.cell, { width: col.meter }, s.strong]}>Meter</Text>
          <Text style={[s.cell, { width: col.type }, s.strong]}>Type</Text>
          <Text style={[s.cell, { width: col.open }, s.right, s.strong]}>Opening</Text>
          <Text style={[s.cell, { width: col.close }, s.right, s.strong]}>Closing</Text>
          <Text style={[s.cell, { width: col.usage }, s.right, s.strong]}>Usage</Text>
        </View>
        {lines.map((l, i) => (
          <View key={l.id} style={i === lines.length - 1 ? s.trLast : s.tr} wrap={false}>
            <Text style={[s.cell, { width: col.meter }]}>
              {l.asset_name}
              {l.asset_code ? `\n${l.asset_code}` : ""}
            </Text>
            <Text style={[s.cell, { width: col.type }]}>
              {billingMeterLabel(l.meter)}
              {l.meter !== "treated" ? "\n(info only)" : ""}
            </Text>
            <Text style={[s.cell, { width: col.open }, s.right]}>{readingText(l.prev_value, l.prev_read_at, l.prev_source)}</Text>
            <Text style={[s.cell, { width: col.close }, s.right]}>{readingText(l.curr_value, l.curr_read_at, l.curr_source)}</Text>
            <Text style={[s.cell, { width: col.usage }, s.right, s.strong]}>
              {formatQty(l.usage)} {METER_UNIT[l.meter]}
            </Text>
          </View>
        ))}
        {lines.length === 0 && (
          <View style={s.trLast}>
            <Text style={[s.cell, s.muted]}>No meters.</Text>
          </View>
        )}
      </View>

      <Text style={s.section} break={lines.length > 2}>
        Meter photos
      </Text>
      {lines.map((l) => (
        <View key={l.id} wrap={false}>
          <Text style={[s.strong, { marginBottom: 4 }]}>
            {l.asset_name} · {billingMeterLabel(l.meter)}
          </Text>
          <View style={s.photoRow}>
            {(["prev", "curr"] as const).map((side) => {
              const photo = side === "prev" ? l.prevPhoto : l.currPhoto;
              const value = side === "prev" ? l.prev_value : l.curr_value;
              const at = side === "prev" ? l.prev_read_at : l.curr_read_at;
              return (
                <View key={side} style={s.photoBox}>
                  {photo ? (
                    // eslint-disable-next-line jsx-a11y/alt-text
                    <Image src={photo} style={s.photo} />
                  ) : (
                    <View style={s.noPhoto}>
                      <Text style={s.muted}>No photo</Text>
                    </View>
                  )}
                  <Text>
                    <Text style={s.strong}>{side === "prev" ? "Opening" : "Closing"}: </Text>
                    {formatQty(value)} {METER_UNIT[l.meter]}
                    {at ? ` · ${formatDateTime(at, timeZone)}` : ""}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>
      ))}

      <View style={s.footer} fixed>
        <Text>
          {inv.location_name} · {inv.invoice_no ?? "Draft"}
        </Text>
        <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
      </View>
    </Page>
  );
}

export async function renderInvoicesPdf(invoices: PdfInvoice[], timeZone: string): Promise<Buffer> {
  return renderToBuffer(
    <Document title={invoices.length === 1 ? (invoices[0].invoice.invoice_no ?? "Draft invoice") : "Invoices"} author="AquaFix">
      {invoices.map((data) => (
        <InvoicePages key={data.invoice.id} data={data} timeZone={timeZone} />
      ))}
    </Document>,
  );
}
