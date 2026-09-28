"use client";

import { useState, useTransition } from "react";
import type { AccountOption, AssetOption, InstructionDetail } from "@/lib/inspections/types";
import { Drawer } from "../drawer";
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from "../ui";
import { saveInstruction } from "./actions";
import { AssetList, AssetPicker } from "./asset-picker";

// Instruction_NewEdit (admins). New: status New, due today (INS-R01). The
// asset list is saved with the instruction; inspected assets can't be
// removed.
export function InstructionEditor({
  instruction,
  assets,
  accounts,
  today,
  onClose,
}: {
  instruction: InstructionDetail | null;
  assets: AssetOption[];
  accounts: AccountOption[];
  today: string;
  onClose: () => void;
}) {
  const [name, setName] = useState(instruction?.name ?? "");
  const [comment, setComment] = useState(instruction?.comment ?? "");
  const [date, setDate] = useState(instruction?.required_completed_date ?? today);
  const [accountId, setAccountId] = useState(instruction?.account_id ?? "");
  const [assetIds, setAssetIds] = useState<string[]>(instruction?.allocations.map((a) => a.asset.id) ?? []);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const locked = instruction?.allocations.filter((a) => a.is_completed).map((a) => a.asset.id) ?? [];

  function save() {
    setError(null);
    setFieldErrors({});
    startTransition(async () => {
      const res = await saveInstruction({
        id: instruction?.id ?? null,
        name,
        comment,
        required_completed_date: date,
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
      title={instruction ? `Instruction ${instruction.legacy_uid}` : "New instruction"}
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
      <div className="flex flex-col gap-5">
        {error && <p className="border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">{error}</p>}

        <Field label="Name" error={fieldErrors.name}>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
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
          <Field label="Required completed date" error={fieldErrors.required_completed_date}>
            <input type="date" className={inputClass} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>

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
          locked={locked}
          onAdd={() => setPickerOpen(true)}
          onRemove={(id) => {
            if (confirm("Are you sure?")) setAssetIds((prev) => prev.filter((x) => x !== id));
          }}
        />
      </div>

      {pickerOpen && (
        <AssetPicker
          open
          assets={assets}
          selected={assetIds}
          locked={locked}
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

// A labelled form field. `group` is for several controls (the weekday
// buttons), which a <label> can't wrap.
export function Field({
  label,
  error,
  group,
  children,
}: {
  label: string;
  error?: string;
  group?: boolean;
  children: React.ReactNode;
}) {
  const content = (
    <>
      <span className={labelClass}>{label}</span>
      {children}
      {error && <span className="text-xs text-danger">{error}</span>}
    </>
  );
  return group ? (
    <div role="group" aria-label={label} className="flex flex-col gap-1.5">
      {content}
    </div>
  ) : (
    <label className="flex flex-col gap-1.5">{content}</label>
  );
}
