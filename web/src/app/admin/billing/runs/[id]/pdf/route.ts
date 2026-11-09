import type { NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { BILLING_ADMINS } from "@/lib/billing/permissions";
import { loadPdfInvoices, renderInvoicesPdf } from "@/lib/billing/pdf";

// Every approved invoice of a run in one PDF (one invoice per section, by
// location), for downloading the month in one go.
export async function GET(_req: NextRequest, ctx: RouteContext<"/admin/billing/runs/[id]/pdf">) {
  await requireRole(BILLING_ADMINS);
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: tz } = await supabase.rpc("app_time_zone");
  const timeZone = (tz as string | null) ?? "Africa/Johannesburg";

  const { data: run } = await supabase.from("billing_run").select("period").eq("id", id).maybeSingle();
  if (!run) return new Response("Billing run not found.", { status: 404 });
  const { data: rows, error } = await supabase
    .from("invoice")
    .select("id")
    .eq("billing_run_id", id)
    .eq("status", "approved")
    .order("location_name");
  if (error) return new Response(error.message, { status: 500 });
  if (!rows || rows.length === 0) return new Response("No approved invoices in this run.", { status: 404 });

  const invoices = await loadPdfInvoices(supabase, rows.map((r) => r.id));
  const pdf = await renderInvoicesPdf(invoices, timeZone);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Invoices_${run.period.slice(0, 7)}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
