"use client";

import { useState, useTransition } from "react";
import {
  SCHEDULE_TYPES,
  SCHEDULE_TYPE_LABELS,
  WEEK_DAYS,
  type AccountOption,
  type AssetOption,
  type ScheduleType,
  type ScheduledInstructionRow,
} from "@/lib/inspections/types";
import { Drawer } from "../drawer";
import { Switch } from "../switch";
import { inputClass, primaryButtonClass, secondaryButtonClass } from "../ui";
import { saveScheduledInstruction } from "./actions";
import { AssetList, AssetPicker } from "./asset-picker";
import { Field } from "./instruction-editor";

// ScheduledInstruction_NewEdit (admins). The fields shown follow the
// schedule type: Daily → weekends / public holidays, Weekly → days,
// Monthly → day of month. New schedules take 1 day to complete (SCH-R07).
export function ScheduleEditor({
  schedule,
  assets,
  accounts,
  readOnly,
  onClose,
}: {
  schedule: ScheduledInstructionRow | null;
  assets: AssetOption[];
  accounts: AccountOption[];
  readOnly: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState(schedule?.name ?? "");
  const [comment, setComment] = useState(schedule?.comment ?? "");
  const [type, setType] = useState<ScheduleType | "">(schedule?.schedule_type ?? "");
  const [accountId, setAccountId] = useState(schedule?.account_id ?? "");
  const [includeWeekends, setIncludeWeekends] = useState(schedule?.include_weekends ?? false);
  const [includeHolidays, setIncludeHolidays] = useState(schedule?.include_public_holidays ?? false);
  const [weekDays, setWeekDays] = useState<number[]>(schedule?.week_days ?? []);
  const [dayOfMonth, setDayOfMonth] = useState(schedule?.day_of_month?.toString() ?? "");
  const [daysToComplete, setDaysToComplete] = useState(String(schedule?.days_to_complete ?? 1));
  const [active, setActive] = useState(schedule?.active ?? true);
  const [assetIds, setAssetIds] = useState<string[]>(schedule?.asset_ids ?? []);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggleDay(day: number) {
    setWeekDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()));
  }

  function save() {
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const res = await saveScheduledInstruction({
        id: schedule?.id ?? null,
        name,
        comment,
        schedule_type: type as ScheduleType,
        include_weekends: includeWeekends,
        include_public_holidays: includeHolidays,
        day_of_month: dayOfMonth.trim() === "" ? null : Number(dayOfMonth),
        week_days: weekDays,
        days_to_complete: daysToComplete.trim() === "" ? 1 : Number(daysToComplete),
        active,
        account_id: accountId,
        asset_ids: assetIds,
      });
      if (res.fieldErrors) setFieldErrors(res.fieldErrors);
      if (res.error) setError(res.error);
      if (!res.error && !res.fieldErrors) onClose();
    });
  }

  return (
    <Drawer
      open
      width={760}
      title={schedule ? `Scheduled instruction ${schedule.legacy_uid}` : "New scheduled instruction"}
      onClose={onClose}
      footer={
        readOnly ? (
          <button type="button" className={secondaryButtonClass} onClick={onClose}>
            Close
          </button>
        ) : (
          <>
            <button type="button" className={secondaryButtonClass} disabled={isPending} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className={primaryButtonClass} disabled={isPending} onClick={save}>
              {isPending ? "Saving…" : "Save"}
            </button>
          </>
        )
      }
    >
      <fieldset disabled={readOnly} className="flex flex-col gap-5">
        {error && <p className="border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">{error}</p>}

        <Field label="Name" error={fieldErrors.name}>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Schedule type" error={fieldErrors.schedule_type}>
            <select
              className={inputClass}
              value={type}
              onChange={(e) => setType(e.target.value as ScheduleType | "")}
            >
              <option value="">Select…</option>
              {SCHEDULE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {SCHEDULE_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Assigned to" error={fieldErrors.account_id}>
            <select className={inputClass} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">Select…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.username}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {type === "daily" && (
          <div className="flex flex-col gap-3 rounded-control border border-border bg-table-head px-4 py-3">
            <Switch checked={includeWeekends} onChange={setIncludeWeekends} label="Include weekends" disabled={readOnly} />
            <Switch
              checked={includeHolidays}
              onChange={setIncludeHolidays}
              label="Include public holidays"
              disabled={readOnly}
            />
          </div>
        )}

        {type === "weekly" && (
          <Field label="Days" error={fieldErrors.week_days} group>
            <div className="flex flex-wrap gap-1.5">
              {WEEK_DAYS.map((d) => {
                const on = weekDays.includes(d.value);
                return (
                  <button
                    key={d.value}
                    type="button"
                    aria-pressed={on}
                    title={d.label}
                    onClick={() => toggleDay(d.value)}
                    className={`h-[36px] w-[52px] rounded-control border text-[13px] font-semibold transition-colors ${
                      on ? "border-primary bg-primary text-white" : "border-border bg-white text-ink hover:bg-black/[.03]"
                    }`}
                  >
                    {d.short}
                  </button>
                );
              })}
            </div>
          </Field>
        )}

        <div className="grid gap-5 sm:grid-cols-2">
          {type === "monthly" && (
            <Field label="Day of month (1–30)" error={fieldErrors.day_of_month}>
              <input
                type="number"
                min={1}
                max={30}
                className={inputClass}
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(e.target.value)}
              />
            </Field>
          )}
          <Field label="Days to complete" error={fieldErrors.days_to_complete}>
            <input
              type="number"
              min={0}
              className={inputClass}
              value={daysToComplete}
              onChange={(e) => setDaysToComplete(e.target.value)}
            />
          </Field>
        </div>

        <Switch checked={active} onChange={setActive} label="Active" disabled={readOnly} />

        <Field label="Comment">
          <textarea
            rows={3}
            className={`${inputClass} !h-auto py-2.5`}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </Field>

        <AssetList
          assets={assets}
          ids={assetIds}
          readOnly={readOnly}
          onAdd={() => setPickerOpen(true)}
          onRemove={(id) => {
            if (confirm("Are you sure?")) setAssetIds((prev) => prev.filter((x) => x !== id));
          }}
        />
      </fieldset>

      {pickerOpen && (
        <AssetPicker
          open
          assets={assets}
          selected={assetIds}
          onClose={() => setPickerOpen(false)}
          onSave={(ids) => {
            setAssetIds(ids);
            setPickerOpen(false);
          }}
        />
      )}
    </Drawer>
  );
}
