import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { INSPECTION_WRITERS } from "@/lib/inspections/permissions";
import { getAppTimeZone, getInstructionDetail } from "../../../admin/inspections/actions";
import { shortDate } from "../../format";
import { PinIcon } from "../../icons";
import { Header } from "../../ui";

export const metadata = { title: "Instruction · AquaFix" };

// Instruction_View (PWA): tap an asset that isn't done yet to inspect it.
export default async function InstructionPage(props: PageProps<"/m/instructions/[uid]">) {
  await requireRole(INSPECTION_WRITERS);
  const { uid } = await props.params;
  const n = Number(uid);
  if (!Number.isInteger(n)) notFound();
  const [instruction, timeZone] = await Promise.all([getInstructionDetail(n), getAppTimeZone()]);
  if (!instruction) notFound();

  const allocations = [...instruction.allocations].sort(
    (a, b) =>
      Number(a.is_completed) - Number(b.is_completed) ||
      a.asset.location.name.localeCompare(b.asset.location.name) ||
      a.asset.name.localeCompare(b.asset.name),
  );

  return (
    <>
      <Header title="Instruction" backHref="/m/instructions" />
      <section className="bg-white px-4 py-4">
        <h2 className="text-[22px] font-semibold">{instruction.name}</h2>
        {instruction.comment && <p className="mt-1 text-[18px] whitespace-pre-line">{instruction.comment}</p>}
        <p className="mt-2 text-[17px] text-[#5b6480]">
          Due {shortDate(instruction.required_completed_date, timeZone)} · {instruction.nr_completed} /{" "}
          {instruction.nr_of_allocations} done
        </p>
      </section>
      <ul className="mt-2 flex-1 bg-white">
        {allocations.map((a) => {
          const row = (
            <div className="flex items-center gap-3 px-4 py-3.5">
              <PinIcon className="h-5 w-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold tracking-wide text-[#5b6480] uppercase">{a.asset.location.name}</div>
                <div className="truncate text-[20px]">{a.asset.name}</div>
                <div className="text-[16px] text-[#5b6480]">{a.asset.asset_type.name}</div>
              </div>
              {a.is_completed ? (
                <span className="rounded-[6px] bg-[#3bb54a] px-3 py-1 text-[16px] font-semibold text-white">Done</span>
              ) : (
                <span className="rounded-[6px] bg-[#0b86d8] px-3 py-1 text-[16px] font-semibold text-white">Inspect</span>
              )}
            </div>
          );
          return (
            <li key={a.id} className="border-b border-[#e6e8f0]">
              {a.is_completed ? (
                <div className="opacity-70">{row}</div>
              ) : (
                <Link
                  href={`/m/inspections/capture?asset=${a.asset.id}&instruction=${instruction.id}`}
                  className="block active:bg-[#eef0fb]"
                >
                  {row}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
