"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formatDateTime } from "@/lib/incidents/format";
import type { CumulativeGridRow } from "@/lib/grid/specs/inspections";
import { isoToZonedInput, zonedInputToIso } from "@/lib/inspections/dates";
import type { ValueEditContext } from "@/lib/inspections/types";
import { inputClass, primaryButtonClass, secondaryButtonClass } from "../ui";
import { updateCumulativeValue, updateValue } from "./actions";

// Save or Cancel goes back to where the user came from (usually the grid,
// with its filters still in the URL); a direct link falls back to `list`.
function useDone(list: string) {
  const router = useRouter();
  return () => {
    if (window.history.length > 1) router.back();
    else router.push(list);
  };
}

function Actions({ pending, onCancel, onSave }: { pending: boolean; onCancel: () => void; onSave: () => void }) {
  return (
    <div className="mt-5 flex justify-end gap-2 border-t border-border pt-4">
      <button type="button" className={secondaryButtonClass} disabled={pending} onClick={onCancel}>
        Cancel
      </button>
      <button type="button" className={primaryButtonClass} disabled={pending} onClick={onSave}>
        {pending ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

// Inspection Values → Edit (admins), as a page (was a modal on the grid).
export function ValueForm({ value, timeZone }: { value: ValueEditContext; timeZone: string }) {
  const done = useDone("/admin/inspections?tab=values");
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
      else done();
    });
  }

  const inputId = "edit-inspection-value";

  return (
    <>
      <dl className="mb-4 grid grid-cols-[110px_1fr] gap-y-1.5 text-sm">
        <dt className="text-muted">Activity</dt>
        <dd className="text-ink">
          <Link
            href={`/admin/inspections/activities/${value.activity.legacy_uid}`}
            className="font-mono text-[13px] font-semibold text-primary hover:text-primary-hover"
          >
            {value.activity.legacy_uid}
          </Link>
        </dd>
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
      <Actions pending={isPending} onCancel={done} onSave={save} />
    </>
  );
}

// InspectionCumulativeValue_Edit (admins), as a page. Audited by trigger.
export function CumulativeForm({ row }: { row: CumulativeGridRow }) {
  const done = useDone("/admin/inspections?tab=cumulative");
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
      else done();
    });
  }

  return (
    <>
      <dl className="mb-4 grid grid-cols-[110px_1fr] gap-y-1.5 text-sm">
        <dt className="text-muted">Asset</dt>
        <dd className="text-ink">{row.asset_name ?? "—"}</dd>
        <dt className="text-muted">Location</dt>
        <dd className="text-ink">{row.location_name ?? "—"}</dd>
        <dt className="text-muted">Inspection</dt>
        <dd className="text-ink">{row.inspection_name ?? "—"}</dd>
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
      <p className="mt-2 text-xs text-muted">The next required reading must be at least this value. Changes are logged.</p>
      {error && <p className="mt-3 border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">{error}</p>}
      <Actions pending={isPending} onCancel={done} onSave={save} />
    </>
  );
}
