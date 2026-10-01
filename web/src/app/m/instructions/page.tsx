import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { INSPECTION_WRITERS } from "@/lib/inspections/permissions";
import { getAppTimeZone, listMyOpenInstructions } from "../../admin/inspections/actions";
import { shortDate } from "../format";
import { ChevronRightIcon, ClipboardCheckIcon } from "../icons";
import { Empty, Header } from "../ui";

export const metadata = { title: "Instructions · AquaFix" };

// Instruction_Overview (PWA): my open instructions, by due date.
export default async function InstructionsPage() {
  await requireRole(INSPECTION_WRITERS);
  const [instructions, timeZone] = await Promise.all([listMyOpenInstructions(), getAppTimeZone()]);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());

  return (
    <>
      <Header title="Instructions" backHref="/m" />
      <div className="flex-1 bg-white">
        {instructions.length === 0 ? (
          <Empty icon={<ClipboardCheckIcon className="h-6 w-6 shrink-0" />}>No open instructions</Empty>
        ) : (
          <ul>
            {instructions.map((i) => {
              const overdue = new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(i.required_completed_date)) < today;
              return (
                <li key={i.id} className="border-b border-[#e6e8f0]">
                  <Link href={`/m/instructions/${i.legacy_uid}`} className="flex items-center gap-3 px-4 py-3.5 active:bg-[#eef0fb]">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[21px] font-semibold">{i.name}</div>
                      {i.comment && <div className="truncate text-[17px] text-[#5b6480]">{i.comment}</div>}
                      <div className="mt-1 flex items-center justify-between text-[17px]">
                        <span className={overdue ? "font-semibold text-[#d92d20]" : ""}>
                          Due {shortDate(i.required_completed_date, timeZone)}
                        </span>
                        <span>
                          {i.nr_completed} / {i.nr_of_allocations} done
                        </span>
                      </div>
                    </div>
                    <ChevronRightIcon className="h-5 w-5 shrink-0" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
