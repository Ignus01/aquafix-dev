import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { BILLING_ADMINS } from "@/lib/billing/permissions";
import { loadPdfInvoices, renderInvoicesPdf } from "@/lib/billing/pdf";

// One invoice as a PDF: a download once approved, an inline DRAFT preview
// before that.
export async function GET(_req: NextRequest, ctx: RouteContext<"/admin/billing/invoices/[id]/pdf">) {
  await requireRole(BILLING_ADMINS);
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: tz } = await supabase.rpc("app_time_zone");
  const timeZone = (tz as string | null) ?? "Africa/Johannesburg";

  const invoices = await loadPdfInvoices(supabase, [id]);
  if (invoices.length === 0) return new Response("Invoice not found.", { status: 404 });
  const { invoice } = invoices[0];

  const pdf = await renderInvoicesPdf(invoices, timeZone);
  const safeName = invoice.location_name.replace(/[^\w-]+/g, "_");
  const name = invoice.invoice_no ? `${invoice.invoice_no}_${safeName}.pdf` : `DRAFT_${safeName}_${invoice.period_end}.pdf`;
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${invoice.status === "approved" ? "attachment" : "inline"}; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
