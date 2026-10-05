import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { todayInZone } from "@/lib/inspections/dates";
import {
  INSPECTION_READERS,
  canSeeBackOffice,
  isInspectionAdmin,
  isInspectionWriter,
} from "@/lib/inspections/permissions";
import { ChevronLeftIcon } from "../../../icons";
import { PageHeader } from "../../../page-header";
import { getAppTimeZone, getInstructionDetail, listAccounts, listAssetOptions } from "../../actions";
import { InstructionView } from "./instruction-view";

// "Instruction: {UID}". Field users only see instructions assigned to them
// (RLS), so anything else is "not found" for them.
export default async function InstructionPage(props: PageProps<"/admin/inspections/instructions/[uid]">) {
  const roles = await requireRole(INSPECTION_READERS);
  const { uid } = await props.params;
  const n = Number(uid);
  if (!Number.isInteger(n) || n <= 0) notFound();

  const isAdmin = isInspectionAdmin(roles);
  const [instruction, timeZone, assets, accounts] = await Promise.all([
    getInstructionDetail(n),
    getAppTimeZone(),
    isAdmin ? listAssetOptions() : [],
    isAdmin ? listAccounts() : [],
  ]);
  if (!instruction) notFound();

  const backOffice = canSeeBackOffice(roles);

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumb="Asset Management / Inspections"
        title={`Instruction: ${instruction.legacy_uid}`}
        actions={
          backOffice && (
            <Link
              href={`/admin/inspections/instructions/${instruction.legacy_uid}/report`}
              className="flex h-[38px] items-center rounded-control border border-border bg-white px-4 text-sm font-medium text-ink transition-colors hover:bg-black/[.02]"
            >
              Report (PDF)
            </Link>
          )
        }
      />
      <div className="flex flex-col gap-4 px-4 pb-10 md:px-8">
        <Link
          href={backOffice ? "/admin/inspections?tab=instructions" : "/admin/inspections?tab=my-instructions"}
          className="inline-flex w-fit items-center gap-1 text-[13px] font-medium text-muted hover:text-ink"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          {backOffice ? "Instructions" : "My instructions"}
        </Link>
        <InstructionView
          instruction={instruction}
          canInspect={isInspectionWriter(roles)}
          canEdit={isAdmin}
          assets={assets}
          accounts={accounts}
          today={todayInZone(timeZone)}
        />
      </div>
    </div>
  );
}
