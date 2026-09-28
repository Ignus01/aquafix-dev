"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { formatDateTime } from "@/lib/incidents/format";
import { formatPlainDate } from "@/lib/inspections/dates";
import {
  INSTRUCTION_STATUS_LABELS,
  type AccountOption,
  type AssetOption,
  type InstructionDetail,
  type InstructionListRow,
} from "@/lib/inspections/types";
import { Drawer } from "../drawer";
import { PlusIcon } from "../icons";
import { dangerLinkButtonClass, linkButtonClass } from "../ui";
import { deleteInstruction, getInstructionDetail } from "./actions";
import { InstructionStatusBadge, Progress, YesNo } from "./badges";
import { DataTable, type Column } from "./data-table";
import { InstructionEditor } from "./instruction-editor";

export const addButtonClass =
  "flex h-[38px] items-center gap-2 rounded-control bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-60";

// Inspection_Overview → Instructions → Instructions. (No 'AdHoc' filter:
// ad-hoc inspections no longer create instructions.)
export function InstructionsPanel({
  instructions,
  assets,
  accounts,
  canEdit,
  today,
  timeZone,
}: {
  instructions: InstructionListRow[];
  assets: AssetOption[];
  accounts: AccountOption[];
  canEdit: boolean;
  today: string;
  timeZone: string;
}) {
  const [editor, setEditor] = useState<null | "loading" | { detail: InstructionDetail | null }>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function openEditor(row: InstructionListRow) {
    setError(null);
    setEditor("loading");
    startTransition(async () => {
      const detail = await getInstructionDetail(row.legacy_uid);
      if (!detail) {
        setEditor(null);
        setError("That instruction no longer exists.");
      } else {
        setEditor({ detail });
      }
    });
  }

  function remove(row: InstructionListRow) {
    if (!confirm(`Delete instruction ${row.legacy_uid}? Its asset list is deleted too.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteInstruction(row.id);
      if (res.error) setError(res.error);
    });
  }

  const columns: Column<InstructionListRow>[] = [
    {
      key: "uid",
      label: "UID",
      text: (r) => r.legacy_uid,
      render: (r) => (
        <Link
          href={`/admin/inspections/instructions/${r.legacy_uid}`}
          className="font-mono text-[13px] font-semibold text-primary hover:text-primary-hover"
        >
          {r.legacy_uid}
        </Link>
      ),
    },
    { key: "name", label: "Name", text: (r) => r.name, render: (r) => r.name },
    {
      key: "comment",
      label: "Comment",
      text: (r) => r.comment,
      className: "",
      render: (r) =>
        r.comment ? (
          <span className="line-clamp-1 max-w-[240px] text-muted" title={r.comment}>
            {r.comment}
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    { key: "account", label: "Assigned to", text: (r) => r.account_name, render: (r) => r.account_name ?? "—" },
    {
      key: "progress",
      label: "Progress",
      text: (r) => `${r.nr_completed} / ${r.nr_of_allocations}`,
      render: (r) => <Progress done={r.nr_completed} total={r.nr_of_allocations} />,
    },
    {
      key: "status",
      label: "Status",
      text: (r) => INSTRUCTION_STATUS_LABELS[r.status],
      render: (r) => <InstructionStatusBadge status={r.status} />,
    },
    {
      key: "due",
      label: "Required completed",
      text: (r) => r.required_completed_date,
      render: (r) => (
        <span className={r.status !== "completed" && r.required_completed_date < today ? "font-semibold text-danger" : ""}>
          {formatPlainDate(r.required_completed_date)}
        </span>
      ),
    },
    {
      key: "scheduled",
      label: "Scheduled",
      text: (r) => (r.is_scheduled ? "Yes" : "No"),
      render: (r) => <YesNo value={r.is_scheduled} />,
    },
    {
      key: "changed",
      label: "Changed",
      text: (r) => formatDateTime(r.updated_at, timeZone),
      render: (r) => <span className="text-muted">{formatDateTime(r.updated_at, timeZone)}</span>,
    },
  ];

  return (
    <>
      {error && <p className="mb-4 border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">{error}</p>}
      <DataTable
        rows={instructions}
        columns={columns}
        getKey={(r) => r.id}
        emptyLabel="No instructions yet."
        searchPlaceholder="Search instructions…"
        exportName="instructions"
        toolbar={
          canEdit && (
            <button type="button" className={addButtonClass} onClick={() => setEditor({ detail: null })}>
              <PlusIcon className="h-4 w-4" />
              Add new
            </button>
          )
        }
        actions={(r) => (
          <span className="flex justify-end gap-3">
            <Link href={`/admin/inspections/instructions/${r.legacy_uid}/report`} className={linkButtonClass}>
              Report
            </Link>
            {canEdit && (
              <>
                <button type="button" className={linkButtonClass} disabled={isPending} onClick={() => openEditor(r)}>
                  Edit
                </button>
                <button type="button" className={dangerLinkButtonClass} disabled={isPending} onClick={() => remove(r)}>
                  Delete
                </button>
              </>
            )}
          </span>
        )}
      />

      {editor === "loading" && (
        <Drawer open width={760} title="Instruction" onClose={() => setEditor(null)}>
          <p className="py-10 text-center text-sm text-muted">Loading…</p>
        </Drawer>
      )}
      {editor && editor !== "loading" && (
        <InstructionEditor
          key={editor.detail?.id ?? "new"}
          instruction={editor.detail}
          assets={assets}
          accounts={accounts}
          today={today}
          onClose={() => setEditor(null)}
        />
      )}
    </>
  );
}
