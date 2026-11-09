import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { INSPECTION_BACK_OFFICE, isInspectionAdmin } from "@/lib/inspections/permissions";
import { PageHeader } from "../../../page-header";
import { getScheduledInstruction, listAccounts, listAssetOptions } from "../../actions";
import { BackLink } from "../../back-link";
import { EditSchedule } from "./edit-schedule";

// ScheduledInstruction_NewEdit: editable for admins, read-only for viewers.
// Where the Scheduled grid's ID link goes.
export default async function SchedulePage(props: PageProps<"/admin/inspections/schedules/[uid]">) {
  const roles = await requireRole(INSPECTION_BACK_OFFICE);
  const { uid } = await props.params;
  const n = Number(uid);
  if (!Number.isInteger(n) || n <= 0) notFound();

  const [schedule, assets, accounts] = await Promise.all([getScheduledInstruction(n), listAssetOptions(), listAccounts()]);
  if (!schedule) notFound();
  const canEdit = isInspectionAdmin(roles);

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumb="Work / Inspections / Scheduled"
        title={`${canEdit ? "Edit scheduled" : "Scheduled"} instruction ${schedule.legacy_uid}`}
      />
      <div className="flex flex-col gap-4 px-4 pb-10 md:px-8">
        <BackLink href="/admin/inspections?tab=schedules" label="Scheduled instructions" />
        <div className="max-w-3xl rounded-card border border-border bg-card p-5 md:p-6">
          <EditSchedule schedule={schedule} assets={assets} accounts={accounts} readOnly={!canEdit} />
        </div>
      </div>
    </div>
  );
}
