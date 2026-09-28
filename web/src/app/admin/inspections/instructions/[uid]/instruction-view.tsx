"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formatPlainDate } from "@/lib/inspections/dates";
import type { AccountOption, AssetOption, InstructionAllocation, InstructionDetail } from "@/lib/inspections/types";
import { ChevronRightIcon } from "../../../icons";
import { dangerLinkButtonClass, sectionHeadingClass, tableHeadCellClass } from "../../../ui";
import { deleteInstructionAllocation } from "../../actions";
import { GradingBadge, InstructionStatusBadge, Progress } from "../../badges";
import { InstructionEditor } from "../../instruction-editor";

// Instruction_ViewProgress (admins: progress, gradings, remove an asset —
// INS-R06) and Instruction_SelectAsset (field users: tap an asset that isn't
// inspected yet to start its inspection — INS-R07), on one page.
export function InstructionView({
  instruction,
  canInspect,
  canEdit,
  assets,
  accounts,
  today,
}: {
  instruction: InstructionDetail;
  canInspect: boolean;
  canEdit: boolean;
  assets: AssetOption[];
  accounts: AccountOption[];
  today: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const overdue = instruction.status !== "completed" && instruction.required_completed_date < today;

  function removeAllocation(a: InstructionAllocation) {
    if (!confirm(`Remove ${a.asset.name} from this instruction?`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteInstructionAllocation(a.id);
      if (res.error) setError(res.error);
      else if (res.instructionDeleted) router.push("/admin/inspections?tab=instructions");
    });
  }

  const captureHref = (a: InstructionAllocation) =>
    `/admin/inspections/capture?asset=${a.asset.id}&instruction=${instruction.id}`;

  return (
    <div className="flex flex-col gap-4">
      <section className="max-w-5xl rounded-card border border-border bg-card px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-ink">{instruction.name}</h2>
              <InstructionStatusBadge status={instruction.status} />
              {instruction.is_scheduled && (
                <span className="rounded-full bg-black/[.04] px-2 py-0.5 text-[11px] font-medium text-muted">Scheduled</span>
              )}
            </div>
            {instruction.comment && <p className="mt-1 text-sm whitespace-pre-line text-muted">{instruction.comment}</p>}
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="h-[34px] rounded-control border border-border bg-white px-3 text-[13px] font-semibold text-ink hover:bg-black/[.03]"
            >
              Edit
            </button>
          )}
        </div>
        <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <div>
            <dt className="text-[12px] text-muted">Assigned to</dt>
            <dd className="text-ink">{instruction.account_name ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-[12px] text-muted">Required completed</dt>
            <dd className={overdue ? "font-semibold text-danger" : "text-ink"}>
              {formatPlainDate(instruction.required_completed_date)}
              {overdue && " · overdue"}
            </dd>
          </div>
          <div>
            <dt className="text-[12px] text-muted">Progress</dt>
            <dd>
              <Progress done={instruction.nr_completed} total={instruction.nr_of_allocations} />
            </dd>
          </div>
        </dl>
      </section>

      {error && <p className="max-w-5xl border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">{error}</p>}

      <section className="max-w-5xl overflow-hidden rounded-card border border-border bg-card">
        <div className="border-b border-border px-5 py-3">
          <h2 className={sectionHeadingClass}>Assets</h2>
        </div>

        {instruction.allocations.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">No assets on this instruction.</p>
        ) : (
          <>
            {/* Phone: Instruction_SelectAsset's list. */}
            <ul className="divide-y divide-border md:hidden">
              {instruction.allocations.map((a) => {
                const body = (
                  <>
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-semibold tracking-wider text-muted uppercase">
                        {a.asset.asset_type.name} · {a.asset.location.name}
                      </div>
                      <div className="truncate font-semibold text-ink">{a.asset.name}</div>
                      <div className="font-mono text-xs text-muted">{a.asset.code}</div>
                    </div>
                    {a.is_completed ? (
                      <span className="flex flex-col items-end gap-1">
                        <span className="text-xs font-semibold text-success">Inspected</span>
                        {a.activity && <GradingBadge grading={a.activity.grading} />}
                      </span>
                    ) : canInspect ? (
                      <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted" />
                    ) : null}
                  </>
                );
                return (
                  <li key={a.id}>
                    {!a.is_completed && canInspect ? (
                      <Link href={captureHref(a)} className="flex items-center gap-3 px-5 py-3 hover:bg-row-hover">
                        {body}
                      </Link>
                    ) : a.activity ? (
                      <Link
                        href={`/admin/inspections/activities/${a.activity.legacy_uid}`}
                        className="flex items-center gap-3 px-5 py-3 hover:bg-row-hover"
                      >
                        {body}
                      </Link>
                    ) : (
                      <div className="flex items-center gap-3 px-5 py-3">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>

            {/* Desktop: Instruction_ViewProgress's grid. */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="bg-table-head">
                    <th className={`${tableHeadCellClass} !px-5`}>Inspection</th>
                    <th className={tableHeadCellClass}>Asset</th>
                    <th className={tableHeadCellClass}>Asset type</th>
                    <th className={tableHeadCellClass}>Location</th>
                    <th className={tableHeadCellClass}>Completed</th>
                    <th className={tableHeadCellClass}>Inspected by</th>
                    <th className={tableHeadCellClass}>Grading</th>
                    <th className={tableHeadCellClass} />
                  </tr>
                </thead>
                <tbody>
                  {instruction.allocations.map((a) => (
                    <tr key={a.id} className="border-t border-border hover:bg-row-hover">
                      <td className="px-5 py-2.5">
                        {a.activity ? (
                          <Link
                            href={`/admin/inspections/activities/${a.activity.legacy_uid}`}
                            className="font-mono text-[13px] font-semibold text-primary hover:text-primary-hover"
                          >
                            {a.activity.legacy_uid}
                          </Link>
                        ) : (
                          <span className="text-[13px] text-muted" title="This Asset has not yet been Inspected.">
                            —
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-ink">
                        {a.asset.name} <span className="font-mono text-xs text-muted">{a.asset.code}</span>
                      </td>
                      <td className="px-3 py-2.5 text-ink">{a.asset.asset_type.name}</td>
                      <td className="px-3 py-2.5 text-ink">{a.asset.location.name}</td>
                      <td className="px-3 py-2.5">
                        {a.is_completed ? (
                          <span className="text-xs font-semibold text-success">Yes</span>
                        ) : (
                          <span className="text-xs text-muted">No</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-ink">{a.activity?.inspected_by_name ?? "—"}</td>
                      <td className="px-3 py-2.5">
                        <GradingBadge grading={a.activity?.grading ?? null} />
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        <span className="flex justify-end gap-3">
                          {!a.is_completed && canInspect && (
                            <Link href={captureHref(a)} className="text-xs font-semibold text-primary hover:text-primary-hover">
                              Inspect
                            </Link>
                          )}
                          {canEdit && !a.is_completed && (
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => removeAllocation(a)}
                              className={dangerLinkButtonClass}
                            >
                              Remove
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {editing && (
        <InstructionEditor
          instruction={instruction}
          assets={assets}
          accounts={accounts}
          today={today}
          onClose={() => {
            setEditing(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
