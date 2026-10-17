"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { formatDateTime } from "@/lib/incidents/format";
import { isoToZonedInput, zonedDay, zonedInputToIso } from "@/lib/inspections/dates";
import type { ActivityListRow, CumulativeRow, ValueEditContext, ValueListRow } from "@/lib/inspections/types";
import { Modal } from "../modal";
import { dangerLinkButtonClass, inputClass, linkButtonClass, primaryButtonClass, secondaryButtonClass } from "../ui";
import { deleteActivity, getValueForEdit, updateCumulativeValue, updateValue } from "./actions";
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

  const day = zonedDay(timeZone);
  const columns: Column<ActivityListRow>[] = [
    { key: "uid", label: "UID", filter: "number", text: (r) => r.legacy_uid, render: (r) => uidLink(r.legacy_uid) },
    {
      key: "instruction",
      label: "Instruction",
      filter: "text",
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
    { key: "asset", label: "Asset", filter: "text", text: (r) => r.asset.name, render: (r) => r.asset.name },
    {
      key: "type",
      label: "Asset type",
      filter: "select",
      text: (r) => r.asset.asset_type.name,
      render: (r) => r.asset.asset_type.name,
    },
    {
      key: "location",
      label: "Location",
      filter: "select",
      text: (r) => r.asset.location.name,
      render: (r) => r.asset.location.name,
    },
    {
      key: "date",
      label: "Inspection date",
      filter: "date",
      filterValue: (r) => day(r.inspection_date),
      text: (r) => formatDateTime(r.inspection_date, timeZone),
      sortValue: (r) => r.inspection_date,
      render: (r) => formatDateTime(r.inspection_date, timeZone),
    },
    {
      key: "by",
      label: "Inspected by",
      filter: "select",
      text: (r) => r.inspected_by_name,
      render: (r) => r.inspected_by_name ?? "—",
    },
    {
      key: "grading",
      label: "Grading",
      filter: "select",
      text: (r) => r.grading?.name ?? "",
      render: (r) => <GradingBadge grading={r.grading} />,
    },
  ];

  return (
    <>
      {error && <p className="mb-4 border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">{error}</p>}
      <DataTable
        rows={activities}
        columns={columns}
        getKey={(r) => r.id}
        emptyLabel="No inspections have been taken yet."
        exportName="inspection-activities"
        rowLimit={null}
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

// Inspection_Overview → Inspection Values, with Edit for admins. Superseded
// Feedback attempts are listed too, marked (Mendix showed them without a
// marker).
export function ValuesPanel({
  values,
  canEdit,
  timeZone,
}: {
  values: ValueListRow[];
  canEdit: boolean;
  timeZone: string;
}) {
  const [editing, setEditing] = useState<ValueEditContext | "loading" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function openEditor(row: ValueListRow) {
    setError(null);
    setEditing("loading");
    startTransition(async () => {
      const ctx = await getValueForEdit(row.id);
      if (ctx) setEditing(ctx);
      else {
        setEditing(null);
        setError("That inspection value no longer exists.");
      }
    });
  }

  const day = zonedDay(timeZone);
  const columns: Column<ValueListRow>[] = [
    {
      key: "uid",
      label: "Activity",
      filter: "number",
      text: (r) => r.activity.legacy_uid,
      render: (r) => uidLink(r.activity.legacy_uid),
    },
    {
      key: "asset",
      label: "Asset",
      filter: "text",
      text: (r) => r.activity.asset.name,
      render: (r) => r.activity.asset.name,
    },
    {
      key: "type",
      label: "Asset type",
      filter: "select",
      text: (r) => r.activity.asset.asset_type.name,
      render: (r) => r.activity.asset.asset_type.name,
    },
    {
      key: "location",
      label: "Location",
      filter: "select",
      text: (r) => r.activity.asset.location.name,
      render: (r) => r.activity.asset.location.name,
    },
    {
      key: "inspection",
      label: "Inspection",
      filter: "select",
      text: (r) => r.inspection.name,
      render: (r) => r.inspection.name,
    },
    {
      key: "value",
      label: "Value",
      filter: "text",
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
      filter: "date",
      filterValue: (r) => day(r.activity.inspection_date),
      text: (r) => formatDateTime(r.activity.inspection_date, timeZone),
      sortValue: (r) => r.activity.inspection_date,
      render: (r) => formatDateTime(r.activity.inspection_date, timeZone),
    },
    {
      key: "grading",
      label: "Grading",
      filter: "select",
      text: (r) => r.grading?.name ?? "",
      render: (r) => <GradingBadge grading={r.grading} />,
    },
    {
      key: "images",
      label: "Images",
      filter: "number",
      text: (r) => r.image_count,
      render: (r) =>
        r.image_count > 0 ? uidLink(r.activity.legacy_uid, `${r.image_count} photo${r.image_count === 1 ? "" : "s"}`) : "0",
    },
  ];

  return (
    <>
      {error && <p className="mb-4 border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">{error}</p>}
      <DataTable
        rows={values}
        columns={columns}
        getKey={(r) => r.id}
        emptyLabel="No inspection values yet."
        exportName="inspection-values"
        rowLimit={null}
        actions={
          canEdit
            ? (r) => (
                <button type="button" className={linkButtonClass} onClick={() => openEditor(r)}>
                  Edit
                </button>
              )
            : undefined
        }
      />
      {editing === "loading" && (
        <Modal open title="Edit inspection value" onClose={() => setEditing(null)}>
          <p className="py-6 text-center text-sm text-muted">Loading…</p>
        </Modal>
      )}
      {editing && editing !== "loading" && (
        <ValueEditor key={editing.id} value={editing} timeZone={timeZone} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function ValueEditor({
  value,
  timeZone,
  onClose,
}: {
  value: ValueEditContext;
  timeZone: string;
  onClose: () => void;
}) {
  const { inspection } = value;
  const isNumber = inspection.value_type === "DECIMAL_VALUE" || inspection.value_type === "CUMULATIVE_VALUE";
  const [text, setText] = useState(value.text_value);
  const [decimal, setDecimal] = useState(String(value.decimal_value));
  const [date, setDate] = useState(value.date_value ?? "");
  const [optionId, setOptionId] = useState(value.inspection_drop_down_option_id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Inactive options stay listed only when they're the current answer.
  const options = inspection.options.filter((o) => o.active || o.id === value.inspection_drop_down_option_id);

  function save() {
    setError(null);
    if (isNumber && (decimal.trim() === "" || !Number.isFinite(Number(decimal)))) {
      setError("Enter a number.");
      return;
    }
    startTransition(async () => {
      const res = await updateValue(value.id, {
        text_value: text,
        decimal_value: isNumber ? Number(decimal) : value.decimal_value,
        date_value: date || null,
        drop_down_option_id: optionId || null,
      });
      if (res.error) setError(res.error);
      else onClose();
    });
  }

  const inputId = "edit-inspection-value";

  return (
    <Modal
      open
      title="Edit inspection value"
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
        <dt className="text-muted">Activity</dt>
        <dd className="text-ink">{uidLink(value.activity.legacy_uid)}</dd>
        <dt className="text-muted">Asset</dt>
        <dd className="text-ink">{value.activity.asset.name}</dd>
        <dt className="text-muted">Inspected</dt>
        <dd className="text-ink">{formatDateTime(value.activity.inspection_date, timeZone)}</dd>
        <dt className="text-muted">Inspection</dt>
        <dd className="text-ink">{inspection.name}</dd>
      </dl>
      <label htmlFor={inputId} className="mb-1.5 block text-xs font-medium text-muted">
        Value{inspection.is_required && <span className="text-danger"> *</span>}
      </label>
      {inspection.value_type === "TEXT" && (
        <textarea
          id={inputId}
          rows={3}
          className={`${inputClass} h-auto py-2`}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      )}
      {isNumber && (
        <input
          id={inputId}
          type="text"
          inputMode="decimal"
          className={inputClass}
          value={decimal}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setDecimal(e.target.value.replace(",", "."))}
        />
      )}
      {inspection.value_type === "DATETIME" && (
        <input
          id={inputId}
          type="datetime-local"
          className={inputClass}
          value={isoToZonedInput(date, timeZone)}
          onChange={(e) => setDate(zonedInputToIso(e.target.value, timeZone))}
        />
      )}
      {inspection.value_type === "DROP_DOWN" && (
        <select id={inputId} className={inputClass} value={optionId} onChange={(e) => setOptionId(e.target.value)}>
          <option value="">Select…</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
              {o.active ? "" : " (inactive)"}
            </option>
          ))}
        </select>
      )}
      <p className="mt-2 text-xs text-muted">
        {!value.is_current
          ? "This is a superseded attempt; its grading still counts towards the inspection's grading. "
          : ""}
        The display value and grading are recalculated
        {inspection.value_type === "CUMULATIVE_VALUE"
          ? ", and the cumulative value follows when this is the asset's latest reading."
          : "."}
      </p>
      {error && <p className="mt-3 border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">{error}</p>}
    </Modal>
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

  const day = zonedDay(timeZone);
  const columns: Column<CumulativeRow>[] = [
    {
      key: "uid",
      label: "UID",
      filter: "number",
      text: (r) => r.legacy_uid,
      render: (r) => <span className="font-mono text-[13px] text-muted">{r.legacy_uid}</span>,
    },
    { key: "asset", label: "Asset", filter: "text", text: (r) => r.asset.name, render: (r) => r.asset.name },
    {
      key: "type",
      label: "Asset type",
      filter: "select",
      text: (r) => r.asset.asset_type.name,
      render: (r) => r.asset.asset_type.name,
    },
    {
      key: "location",
      label: "Location",
      filter: "select",
      text: (r) => r.asset.location.name,
      render: (r) => r.asset.location.name,
    },
    {
      key: "inspection",
      label: "Inspection",
      filter: "select",
      text: (r) => r.inspection.name,
      render: (r) => r.inspection.name,
    },
    {
      key: "value",
      label: "Latest value",
      filter: "number",
      text: (r) => r.latest_value,
      render: (r) => <span className="font-semibold tabular-nums">{r.latest_value}</span>,
    },
    {
      key: "updated",
      label: "Update date",
      filter: "date",
      filterValue: (r) => day(r.updated_at),
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
        exportName="cumulative-values"
        rowLimit={null}
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
