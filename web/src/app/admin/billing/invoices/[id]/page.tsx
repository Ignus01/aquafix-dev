import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { BILLING_ADMINS } from "@/lib/billing/permissions";
import { formatPeriod } from "@/lib/billing/format";
import { PageHeader } from "../../../page-header";
import { ChevronLeftIcon } from "../../../icons";
import { getAppTimeZone } from "../../../services/actions";
import { getInvoice } from "../../actions";
import { InvoiceView } from "./invoice-view";

// One invoice: each meter's opening and closing reading with its photo, the
// checks, and approve / void / PDF.
export default async function InvoicePage(props: PageProps<"/admin/billing/invoices/[id]">) {
  await requireRole(BILLING_ADMINS);
  const { id } = await props.params;
  const [detail, timeZone] = await Promise.all([getInvoice(id), getAppTimeZone()]);
  if (!detail) notFound();
  const { invoice } = detail;

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumb={`Billing / ${formatPeriod(detail.period)}`}
        title={invoice.invoice_no ? `${invoice.invoice_no} · ${invoice.location_name}` : invoice.location_name}
      />
      <div className="px-4 pb-10 md:px-8">
        <Link
          href={`/admin/billing/runs/${invoice.billing_run_id}`}
          className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:text-primary-hover"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          {formatPeriod(detail.period)} invoices
        </Link>
        <InvoiceView detail={detail} timeZone={timeZone} />
      </div>
    </div>
  );
}
