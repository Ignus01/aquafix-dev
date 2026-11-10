import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { todayInZone } from "@/lib/inspections/dates";
import { INSPECTION_ADMINS } from "@/lib/inspections/permissions";
import { ChevronLeftIcon } from "../../../icons";
import { PageHeader } from "../../../page-header";
import { getAppTimeZone, listAccounts, listAssetOptions } from "../../actions";
import { EditInstruction } from "../[uid]/edit/edit-instruction";

// Instruction_NewEdit (admins) for a new instruction. A page rather than a
// drawer on the grid, so the grid doesn't load every asset just in case.
export default async function NewInstructionPage() {
  await requireRole(INSPECTION_ADMINS);
  const [timeZone, assets, accounts] = await Promise.all([getAppTimeZone(), listAssetOptions(), listAccounts()]);

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader breadcrumb="Work / Inspections / Instructions" title="New instruction" />
      <div className="flex flex-col gap-4 px-4 pb-10 md:px-8">
        <Link
          href="/admin/inspections?tab=instructions"
          className="inline-flex w-fit items-center gap-1 text-[13px] font-medium text-muted hover:text-ink"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          Instructions
        </Link>
        <div className="max-w-3xl rounded-card border border-border bg-card p-5 md:p-6">
          <EditInstruction instruction={null} assets={assets} accounts={accounts} today={todayInZone(timeZone)} />
        </div>
      </div>
    </div>
  );
}
