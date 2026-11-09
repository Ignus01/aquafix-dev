import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { BILLING_ADMINS } from "@/lib/billing/permissions";
import { formatPeriod } from "@/lib/billing/format";
import { PageHeader } from "../../../page-header";
import { ChevronLeftIcon } from "../../../icons";
import { getRun, listRunInvoices } from "../../actions";
import { InvoicesReview } from "./invoices-review";

// One month's invoices: check them, regenerate drafts, approve in bulk and
// download the approved PDFs.
export default async function BillingRunPage(props: PageProps<"/admin/billing/runs/[id]">) {
  await requireRole(BILLING_ADMINS);
  const { id } = await props.params;
  const run = await getRun(id);
  if (!run) notFound();
  const invoices = await listRunInvoices(id);

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader breadcrumb="Billing / Runs" title={formatPeriod(run.period)} />
      <div className="px-4 pb-10 md:px-8">
        <Link
          href="/admin/billing"
          className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:text-primary-hover"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          All billing runs
        </Link>
        <InvoicesReview runId={run.id} period={run.period} invoices={invoices} />
      </div>
    </div>
  );
}
