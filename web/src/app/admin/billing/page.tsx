import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { todayInZone } from "@/lib/inspections/dates";
import { BILLING_ADMINS } from "@/lib/billing/permissions";
import { PageHeader } from "../page-header";
import { getAppTimeZone } from "../services/actions";
import { getSetup, listRuns } from "./actions";
import { GenerateForm } from "./generate-form";
import { RunsTable } from "./runs-table";
import { SetupTable } from "./setup-table";

const TABS = [
  { key: "runs", label: "Billing runs" },
  { key: "setup", label: "Location setup" },
] as const;

// Admin → Billing: generate a month's draft invoices, open a run to review and
// approve them, and set each location's billing day, tariff and meters.
export default async function BillingPage(props: PageProps<"/admin/billing">) {
  await requireRole(BILLING_ADMINS);
  const params = await props.searchParams;
  const tab = TABS.find((t) => t.key === params.tab)?.key ?? "runs";
  const timeZone = await getAppTimeZone();
  const today = todayInZone(timeZone);

  let content: React.ReactNode;
  if (tab === "setup") {
    content = <SetupTable locations={await getSetup()} today={today} timeZone={timeZone} />;
  } else {
    const [runs, setup] = await Promise.all([listRuns(), getSetup()]);
    const billed = setup.filter((l) => l.billing_day !== null);
    content = (
      <div className="flex flex-col gap-6">
        <GenerateForm
          defaultMonth={today.slice(0, 7)}
          billedCount={billed.length}
          noTariffCount={billed.filter((l) => l.tariffs.length === 0).length}
          unbilledCount={setup.length - billed.length}
        />
        <RunsTable runs={runs} timeZone={timeZone} />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader breadcrumb="Billing" title="Billing" />
      <div className="px-4 pb-10 md:px-8">
        <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-border">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={t.key === "runs" ? "/admin/billing" : `/admin/billing?tab=${t.key}`}
              className={`border-b-2 px-4 py-2.5 text-sm font-semibold whitespace-nowrap transition-colors ${
                tab === t.key ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        {content}
      </div>
    </div>
  );
}
