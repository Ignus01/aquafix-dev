import { requireRole } from "@/lib/auth";
import { INSPECTION_ADMINS } from "@/lib/inspections/permissions";
import { PageHeader } from "../../../page-header";
import { listAccounts, listAssetOptions } from "../../actions";
import { BackLink } from "../../back-link";
import { EditSchedule } from "../[uid]/edit-schedule";

// ScheduledInstruction_NewEdit for a new schedule (admins).
export default async function NewSchedulePage() {
  await requireRole(INSPECTION_ADMINS);
  const [assets, accounts] = await Promise.all([listAssetOptions(), listAccounts()]);

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader breadcrumb="Work / Inspections / Scheduled" title="New scheduled instruction" />
      <div className="flex flex-col gap-4 px-4 pb-10 md:px-8">
        <BackLink href="/admin/inspections?tab=schedules" label="Scheduled instructions" />
        <div className="max-w-3xl rounded-card border border-border bg-card p-5 md:p-6">
          <EditSchedule schedule={null} assets={assets} accounts={accounts} readOnly={false} />
        </div>
      </div>
    </div>
  );
}
