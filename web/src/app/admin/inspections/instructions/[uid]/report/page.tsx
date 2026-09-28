import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { formatDateTime } from "@/lib/incidents/format";
import { formatPlainDate } from "@/lib/inspections/dates";
import { INSPECTION_BACK_OFFICE } from "@/lib/inspections/permissions";
import { INSTRUCTION_STATUS_LABELS } from "@/lib/inspections/types";
import { ChevronLeftIcon } from "../../../../icons";
import { getAppTimeZone, getInstructionReport } from "../../../actions";
import { GradingBadge } from "../../../badges";
import { PrintButton } from "./print-button";

// The browser's "Save as PDF" suggests the page title as the file name —
// INS-{UID}.pdf, as ACT_Instruction_DownloadPDF named it.
export async function generateMetadata(
  props: PageProps<"/admin/inspections/instructions/[uid]/report">,
): Promise<Metadata> {
  const { uid } = await props.params;
  return { title: `INS-${uid}` };
}

// INS-R09: Instruction_ViewInspectionActivity as a printable page (replaces
// the DocumentGeneration module and its `pdfservice` account).
export default async function InstructionReportPage(
  props: PageProps<"/admin/inspections/instructions/[uid]/report">,
) {
  await requireRole(INSPECTION_BACK_OFFICE);
  const { uid } = await props.params;
  const n = Number(uid);
  if (!Number.isInteger(n) || n <= 0) notFound();

  const [report, timeZone] = await Promise.all([getInstructionReport(n), getAppTimeZone()]);
  if (!report) notFound();
  const { instruction, activities } = report;

  return (
    <div className="px-4 py-6 md:px-8 print:p-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link
          href={`/admin/inspections/instructions/${instruction.legacy_uid}`}
          className="inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-ink"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          Instruction {instruction.legacy_uid}
        </Link>
        <PrintButton />
      </div>

      <article className="mx-auto max-w-4xl rounded-card border border-border bg-card p-8 print:max-w-none print:rounded-none print:border-0 print:p-0">
        <header className="border-b border-border pb-4">
          <div className="text-[11px] font-semibold tracking-wider text-muted uppercase">Instruction report</div>
          <h1 className="mt-1 text-2xl font-bold text-ink">
            INS-{instruction.legacy_uid} · {instruction.name}
          </h1>
          {instruction.comment && <p className="mt-1 text-sm whitespace-pre-line text-muted">{instruction.comment}</p>}
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-[12px] text-muted">Assigned to</dt>
              <dd className="text-ink">{instruction.account_name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-muted">Required completed</dt>
              <dd className="text-ink">{formatPlainDate(instruction.required_completed_date)}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-muted">Status</dt>
              <dd className="text-ink">{INSTRUCTION_STATUS_LABELS[instruction.status]}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-muted">Progress</dt>
              <dd className="text-ink">
                {instruction.nr_completed} / {instruction.nr_of_allocations}
              </dd>
            </div>
          </dl>
        </header>

        {activities.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">No inspections have been done on this instruction yet.</p>
        ) : (
          activities.map((a) => (
            <section key={a.id} className="break-inside-avoid border-b border-border py-5 last:border-b-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-base font-semibold text-ink">
                  {a.asset.name} <span className="font-mono text-xs font-normal text-muted">{a.asset.code}</span>
                </h2>
                <GradingBadge grading={a.grading} />
              </div>
              <p className="text-[13px] text-muted">
                Inspection {a.legacy_uid} · {a.asset.asset_type.name} · {a.asset.location.name} ·{" "}
                {formatDateTime(a.inspection_date, timeZone)} · {a.inspected_by_name ?? "—"}
              </p>
              <table className="mt-3 w-full text-sm">
                <tbody>
                  {a.values.map((v) => (
                    <tr key={v.id} className="border-t border-border align-top">
                      <td className="w-1/3 py-2 pr-3 text-muted">
                        {v.inspection.name}
                        {!v.is_current && <span className="ml-1 text-[11px]">(superseded)</span>}
                      </td>
                      <td className="py-2 pr-3 whitespace-pre-line text-ink">{v.display_value || "—"}</td>
                      <td className="w-28 py-2 text-right">
                        {v.grading && <GradingBadge grading={v.grading} />}
                      </td>
                    </tr>
                  ))}
                  {a.values.some((v) => v.images.length > 0) && (
                    <tr className="border-t border-border">
                      <td colSpan={3} className="py-2">
                        <div className="flex flex-wrap gap-2">
                          {a.values.flatMap((v) =>
                            v.images.map((img) =>
                              img.thumb_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  key={img.id}
                                  src={img.url ?? img.thumb_url}
                                  alt={v.inspection.name}
                                  className="h-32 w-32 rounded-control border border-border object-cover"
                                />
                              ) : null,
                            ),
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
          ))
        )}
      </article>
    </div>
  );
}
