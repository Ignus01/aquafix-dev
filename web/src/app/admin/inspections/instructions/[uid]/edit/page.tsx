import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { todayInZone } from "@/lib/inspections/dates";
import { INSPECTION_ADMINS } from "@/lib/inspections/permissions";
import { ChevronLeftIcon } from "../../../../icons";
import { PageHeader } from "../../../../page-header";
import { getAppTimeZone, getInstructionDetail, listAccounts, listAssetOptions } from "../../../actions";
import { EditInstruction } from "./edit-instruction";

// Instruction_NewEdit (admins) as a page: where the grid's ID link goes.
export default async function EditInstructionPage(props: PageProps<"/admin/inspections/instructions/[uid]/edit">) {
  await requireRole(INSPECTION_ADMINS);
  const { uid } = await props.params;
  const n = Number(uid);
  if (!Number.isInteger(n) || n <= 0) notFound();

  const [instruction, timeZone, assets, accounts] = await Promise.all([
    getInstructionDetail(n),
    getAppTimeZone(),
    listAssetOptions(),
    listAccounts(),
  ]);
  if (!instruction) notFound();

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader breadcrumb="Work / Inspections / Instructions" title={`Edit instruction ${instruction.legacy_uid}`} />
      <div className="flex flex-col gap-4 px-4 pb-10 md:px-8">
        <span className="flex flex-wrap items-center gap-4">
          <Link
            href="/admin/inspections?tab=instructions"
            className="inline-flex w-fit items-center gap-1 text-[13px] font-medium text-muted hover:text-ink"
          >
            <ChevronLeftIcon className="h-4 w-4" />
            Instructions
          </Link>
          <Link
            href={`/admin/inspections/instructions/${instruction.legacy_uid}`}
            className="text-[13px] font-semibold text-primary hover:text-primary-hover"
          >
            View progress
          </Link>
        </span>
        <div className="max-w-3xl rounded-card border border-border bg-card p-5 md:p-6">
          <EditInstruction instruction={instruction} assets={assets} accounts={accounts} today={todayInZone(timeZone)} />
        </div>
      </div>
    </div>
  );
}
