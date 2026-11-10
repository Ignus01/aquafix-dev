"use client";

import Link from "next/link";
import { useState } from "react";
import { formatPlainDate } from "@/lib/inspections/dates";
import { SYSTEM_OPTION } from "@/lib/grid/fields";
import { instructionsGrid, type InstructionGridRow } from "@/lib/grid/specs/instructions";
import type { ChoiceOption, GridParams, GridResult } from "@/lib/grid/types";
import { changedColumns, Dash, type GridColumn } from "../grid/columns";
import { Grid } from "../grid/grid";
import type { RowMenuItem } from "../grid/row-menu";
import { PlusIcon } from "../icons";
import { deleteInstruction } from "./actions";
import { InstructionStatusBadge, Progress, YesNo } from "./badges";

export const addButtonClass =
  "flex h-[38px] items-center gap-2 rounded-control bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-60";

// Inspection_Overview → Instructions → Instructions, one page at a time from
// instruction_grid. (No 'AdHoc' filter: ad-hoc inspections no longer create
// instructions.)
export function InstructionsPanel({
  result,
  params,
  userOptions,
  canEdit,
  today,
  timeZone,
}: {
  result: GridResult<InstructionGridRow>;
  params: GridParams;
  userOptions: ChoiceOption[];
  canEdit: boolean;
  today: string;
  timeZone: string;
}) {
  const [error, setError] = useState<string | null>(null);

  const viewHref = (r: InstructionGridRow) => `/admin/inspections/instructions/${r.uid}`;

  const columns: GridColumn<InstructionGridRow>[] = [
    { key: "uid", render: (r) => r.uid },
    { key: "name", render: (r) => r.name },
    {
      key: "comment",
      className: "",
      render: (r) =>
        r.comment ? (
          <span className="line-clamp-1 max-w-[240px] text-muted" title={r.comment}>
            {r.comment}
          </span>
        ) : (
          <Dash />
        ),
    },
    { key: "account", render: (r) => r.account_name ?? <Dash /> },
    { key: "progress", render: (r) => <Progress done={r.nr_completed} total={r.nr_of_allocations} /> },
    { key: "status", render: (r) => <InstructionStatusBadge status={r.status} /> },
    {
      key: "due",
      render: (r) => (
        <span className={r.status !== "completed" && r.required_completed_date < today ? "font-semibold text-danger" : ""}>
          {formatPlainDate(r.required_completed_date)}
        </span>
      ),
    },
    { key: "scheduled", render: (r) => <YesNo value={r.is_scheduled} /> },
    ...changedColumns<InstructionGridRow>(timeZone),
  ];

  function menu(r: InstructionGridRow): RowMenuItem[] {
    const items: RowMenuItem[] = [
      { label: "View", href: viewHref(r) },
      ...(canEdit ? [{ label: "Edit", href: `${viewHref(r)}/edit` }] : []),
      { label: "Report", href: `${viewHref(r)}/report` },
      {
        label: "Copy link",
        onSelect: () => navigator.clipboard?.writeText(`${window.location.origin}${viewHref(r)}`),
      },
    ];
    if (canEdit) {
      items.push({
        label: "Delete",
        danger: true,
        confirm: `Instruction ${r.uid} and its asset list will be deleted. This can't be undone.`,
        onSelect: async () => {
          setError(null);
          const res = await deleteInstruction(r.id);
          if (res.error) setError(res.error);
        },
      });
    }
    return items;
  }

  return (
    <>
      {error && <p className="mb-4 border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">{error}</p>}
      <Grid
        mode="server"
        spec={instructionsGrid}
        result={result}
        params={params}
        columns={columns}
        getKey={(r) => r.id}
        title="Instructions"
        timeZone={timeZone}
        rowHref={(r) => (canEdit ? `${viewHref(r)}/edit` : viewHref(r))}
        rowLabel={(r) => `instruction ${r.uid}`}
        rowMenu={menu}
        options={{ account: userOptions, changed_by: [...userOptions, SYSTEM_OPTION] }}
        emptyLabel="No instructions yet."
        primaryAction={
          canEdit && (
            <Link href="/admin/inspections/instructions/new" className={addButtonClass}>
              <PlusIcon className="h-4 w-4" />
              New instruction
            </Link>
          )
        }
      />
    </>
  );
}
