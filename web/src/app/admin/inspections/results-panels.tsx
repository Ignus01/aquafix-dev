"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { formatDateTime } from "@/lib/incidents/format";
import type { ActivityListRow, CumulativeRow, ValueListRow } from "@/lib/inspections/types";
import { Modal } from "../modal";
import { dangerLinkButtonClass, inputClass, linkButtonClass, primaryButtonClass, secondaryButtonClass } from "../ui";
import { deleteActivity, updateCumulativeValue } from "./actions";
import { GradingBadge } from "./badges";
import { DataTable, type Column } from "./data-table";

const uidLink = (uid: number, label: string | number = uid) => (
  <Link
    href={`/admin/inspections/activities/${uid}`}
    className="font-mono text-[13px] font-semibold text-primary hover:text-primary-hover"
  >
    {label}
  </Link>
);

// Inspection_Overview → Inspection Activities.
export function ActivitiesPanel({
  activities,
  canDelete,
  timeZone,
}: {
  activities: ActivityListRow[];
  canDelete: boolean;
  timeZone: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function remove(row: ActivityListRow) {
    if (!confirm(`Delete inspection ${row.legacy_uid} of ${row.asset.name}? Its values and photos are deleted too.`)) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await deleteActivity(row.id);
      if (res.error) setError(res.error);
    });
  }

  const columns: Column<ActivityListRow>[] = [
    { key: "uid", label: "UID", text: (r) => r.legacy_uid, render: (r) => uidLink(r.legacy_uid) },
    {
      key: "instruction",
      label: "Instruction",
      text: (r) => r.instruction?.name ?? "Ad hoc",
      render: (r) =>
        r.instruction ? (
          <Link href={`/admin/inspections/instructions/${r.instruction.legacy_uid}`} className="hover:text-primary">
            {r.instruction.name}
          </Link>
        ) : (
          <span className="text-muted">Ad hoc</span>
        ),
    },
    { key: "asset", label: "Asset", text: (r) => r.asset.name, render: (r) => r.asset.name },
    { key: "type", label: "Asset type", text: (r) => r.asset.asset_type.name, render: (r) => r.asset.asset_type.name },
    { key: "location", label: "Location", text: (r) => r.asset.location.name, render: (r) => r.asset.location.name },
    {
      key: "date",
      label: "Inspection date",
      text: (r) => formatDateTime(r.inspection_date, timeZone),
      sortValue: (r) => r.inspection_date,
      render: (r) => formatDateTime(r.inspection_date, timeZone),
    },
    { key: "by", label: "Inspected by", text: (r) => r.inspected_by_name, render: (r) => r.inspected_by_name ?? "—" },
    { key: "grading", label: "Grading", text: (r) => r.grading?.name ?? "", render: (r) => <GradingBadge grading={r.grading} /> },
  ];

  return (
    <>
      {error && <p className="mb-4 border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">{error}</p>}
      <DataTable
        rows={activities}
        columns={columns}
        getKey={(r) => r.id}
        emptyLabel="No inspections have been taken yet."
        searchPlaceholder="Search asset, location, inspector…"
        exportName="inspection-activities"
        actions={
          canDelete
            ? (r) => (
                <button type="button" className={dangerLinkButtonClass} disabled={isPending} onClick={() => remove(r)}>
                  Delete
                </button>
              )
            : undefined
        }
      />
    </>
  );
}

// Inspection_Overview → Inspection Values. Superseded Feedback attempts are
// listed too, marked (Mendix showed them without a marker).
export function ValuesPanel({ values, timeZone }: { values: ValueListRow[]; timeZone: string }) {
  const columns: Column<ValueListRow>[] = [
    {
      key: "uid",
      label: "Activity",
      text: (r) => r.activity.legacy_uid,
      render: (r) => uidLink(r.activity.legacy_uid),
    },
    { key: "asset", label: "Asset", text: (r) => r.activity.asset.name, render: (r) => r.activity.asset.name },
    {
      key: "type",
      label: "Asset type",
      text: (r) => r.activity.asset.asset_type.name,
      render: (r) => r.activity.asset.asset_type.name,
    },
    {
      key: "location",
      label: "Location",
      text: (r) => r.activity.asset.location.name,
      render: (r) => r.activity.asset.location.name,
    },
    { key: "inspection", label: "Inspection", text: (r) => r.inspection.name, render: (r) => r.inspection.name },
    {
      key: "value",
      label: "Value",
      text: (r) => r.display_value,
      className: "",
      render: (r) => (
        <span className="inline-flex items-center gap-2">
          <span className="line-clamp-1 max-w-[220px] text-ink" title={r.display_value}>
            {r.display_value || <span className="text-muted">—</span>}
          </span>
          {!r.is_current && (
            <span className="rounded-full bg-black/[.05] px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-muted">
              superseded
            </span>
          )}
        </span>
      ),
    },
    {
      key: "date",
      label: "Inspection date",
      text: (r) => formatDateTime(r.activity.inspection_date, timeZone),
      sortValue: (r) => r.activity.inspection_date,
      render: (r) => formatDateTime(r.activity.inspection_date, timeZone),
    },
    { key: "grading", label: "Grading", text: (r) => r.grading?.name ?? "", render: (r) => <GradingBadge grading={r.grading} /> },
    {
      key: "images",
      label: "Images",
      text: (r) => r.image_count,
      render: (r) =>
        r.image_count > 0 ? uidLink(r.activity.legacy_uid, `${r.image_count} photo${r.image_count === 1 ? "" : "s"}`) : "0",
    },
  ];

  return (
    <DataTable
      rows={values}
      columns={columns}
      getKey={(r) => r.id}
      emptyLabel="No inspection values yet."
      searchPlaceholder="Search asset, inspection, value…"
      exportName="inspection-values"
    />
  );
}

// Inspection_Overview → Cumulative Values, with InspectionCumulativeValue_Edit
// for admins (audited in inspection_cumulative_value_change).
export function CumulativePanel({
  rows,
  canEdit,
  timeZone,
}: {
  rows: CumulativeRow[];
  canEdit: boolean;
  timeZone: string;
}) {
  const [editing, setEditing] = useState<CumulativeRow | null>(null);

  const columns: Column<CumulativeRow>[] = [
    { key: "uid", label: "UID", text: (r) => r.legacy_uid, render: (r) => <span className="font-mono text-[13px] text-muted">{r.legacy_uid}</span> },
    { key: "asset", label: "Asset", text: (r) => r.asset.name, render: (r) => r.asset.name },
    { key: "type", label: "Asset type", text: (r) => r.asset.asset_type.name, render: (r) => r.asset.asset_type.name },
    { key: "location", label: "Location", text: (r) => r.asset.location.name, render: (r) => r.asset.location.name },
    { key: "inspection", label: "Inspection", text: (r) => r.inspection.name, render: (r) => r.inspection.name },
    {
      key: "value",
      label: "Latest value",
      text: (r) => r.latest_value,
      render: (r) => <span className="font-semibold tabular-nums">{r.latest_value}</span>,
    },
    {
      key: "updated",
      label: "Update date",
      text: (r) => formatDateTime(r.updated_at, timeZone),
      sortValue: (r) => r.updated_at,
      render: (r) => formatDateTime(r.updated_at, timeZone),
    },
  ];

  return (
    <>
      <DataTable
        rows={rows}
        columns={columns}
        getKey={(r) => r.id}
        emptyLabel="No cumulative readings yet."
        searchPlaceholder="Search asset, inspection…"
        exportName="cumulative-values"
        actions={
          canEdit
            ? (r) => (
                <button type="button" className={linkButtonClass} onClick={() => setEditing(r)}>
                  Edit
                </button>
              )
            : undefined
        }
      />
      {editing && <CumulativeEditor row={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function CumulativeEditor({ row, onClose }: { row: CumulativeRow; onClose: () => void }) {
  const [value, setValue] = useState(String(row.latest_value));
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function save() {
    setError(null);
    if (value.trim() === "" || !Number.isFinite(Number(value))) {
      setError("Enter a number.");
      return;
    }
    startTransition(async () => {
      const res = await updateCumulativeValue(row.id, Number(value));
      if (res.error) setError(res.error);
      else onClose();
    });
  }

  return (
    <Modal
      open
      title="Edit cumulative value"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={secondaryButtonClass} disabled={isPending} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={primaryButtonClass} disabled={isPending} onClick={save}>
            {isPending ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <dl className="mb-4 grid grid-cols-[110px_1fr] gap-y-1.5 text-sm">
        <dt className="text-muted">Asset</dt>
        <dd className="text-ink">{row.asset.name}</dd>
        <dt className="text-muted">Inspection</dt>
        <dd className="text-ink">{row.inspection.name}</dd>
      </dl>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted">Latest value</span>
        <input
          type="number"
          step="any"
          inputMode="decimal"
          className={inputClass}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <p className="mt-2 text-xs text-muted">
        The next required reading must be at least this value. Changes are logged.
      </p>
      {error && <p className="mt-3 border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">{error}</p>}
    </Modal>
  );
}
