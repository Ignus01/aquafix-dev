"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { isoToZonedInput, todayInZone, zonedInputToIso } from "@/lib/inspections/dates";
import { DOC_CONFIG, type DocKind, type Field } from "@/lib/stock-manager/docs";
import type { Options } from "@/lib/stock-manager/docs";
import { saveHeader, saveLine } from "../../../../admin/stock-manager/actions";
import { ConfirmDialog, Sheet } from "../../../components";
import { PlusIcon, XIcon } from "../../../icons";
import { ErrorLine, FormFooter, mBtnDark, mBtnGreen, mBtnLight, mInput, mLabel } from "../../../ui";

type Values = Record<string, string>;
type Line = { key: string; values: Values };

// Starting values: today / now for dates, SEND for a transfer, else empty.
function initial(fields: Field[], timeZone: string): Values {
  const v: Values = {};
  for (const f of fields) {
    if (f.type === "date") v[f.key] = todayInZone(timeZone);
    else if (f.type === "datetime") v[f.key] = isoToZonedInput(new Date().toISOString(), timeZone);
    else if (f.type === "bool") v[f.key] = "false";
    else v[f.key] = f.key === "transfer_type" ? "SEND" : "";
  }
  return v;
}

// Datetime-local text -> absolute ISO for the server action.
function toWire(fields: Field[], values: Values, timeZone: string): Values {
  const out: Values = { ...values };
  for (const f of fields) {
    if (f.type === "datetime" && out[f.key]) out[f.key] = zonedInputToIso(out[f.key], timeZone);
  }
  return out;
}

function validate(fields: Field[], values: Values): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    if (f.showWhen && !f.showWhen(values)) continue;
    if (f.required && f.type !== "bool" && !values[f.key]?.trim()) errors[f.key] = "Required";
    else if (f.type === "number" && values[f.key]?.trim() && !Number.isFinite(Number(values[f.key]))) {
      errors[f.key] = "Enter a number.";
    }
  }
  return errors;
}

function FieldInput({
  field,
  value,
  options,
  error,
  onChange,
  idPrefix,
}: {
  field: Field;
  value: string;
  options: Options;
  error?: string;
  onChange: (v: string) => void;
  idPrefix: string;
}) {
  const id = `${idPrefix}-${field.key}`;
  return (
    <div className="mt-4 first:mt-0">
      <label htmlFor={id} className={mLabel}>
        {field.label}
      </label>
      {field.type === "textarea" ? (
        <textarea id={id} rows={4} className={`${mInput} !h-auto py-3`} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : field.type === "select" ? (
        <select id={id} className={mInput} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select…</option>
          {options[field.options!].map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : field.type === "bool" ? (
        <label className="flex items-center gap-3 text-[19px]">
          <input
            id={id}
            type="checkbox"
            className="h-6 w-6"
            checked={value === "true"}
            onChange={(e) => onChange(e.target.checked ? "true" : "false")}
          />
          {field.hint ?? "Yes"}
        </label>
      ) : (
        <input
          id={id}
          type={field.type === "datetime" ? "datetime-local" : field.type === "date" ? "date" : "text"}
          inputMode={field.type === "number" ? "decimal" : undefined}
          className={mInput}
          value={value}
          onChange={(e) => onChange(field.type === "number" ? e.target.value.replace(",", ".") : e.target.value)}
        />
      )}
      <ErrorLine>{error}</ErrorLine>
    </div>
  );
}

// A new stock document for the phone: header, then (where the document has
// them) its lines — "Add Item" like the PWA. Saving creates the header and
// then each line; if a line fails the header is kept and Save retries only
// the lines that didn't go in.
export function DocForm({ kind, options, timeZone }: { kind: DocKind; options: Options; timeZone: string }) {
  const router = useRouter();
  const cfg = DOC_CONFIG[kind];
  const lineCfg = cfg.line && !cfg.line.noAdd ? cfg.line : null;

  const [values, setValues] = useState<Values>(() => initial(cfg.header, timeZone));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [adding, setAdding] = useState<Values | null>(null);
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [isPending, startTransition] = useTransition();

  const label = (f: Field, v: string) =>
    f.type === "select" ? (options[f.options!].find((o) => o.value === v)?.label ?? v) : v;

  function save() {
    setError(null);
    const found = validate(cfg.header, values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    if (lineCfg && lines.length === 0 && kind !== "loads") {
      setError("Add at least one item.");
      return;
    }

    startTransition(async () => {
      let id = docId;
      if (!id) {
        const res = await saveHeader(kind, null, toWire(cfg.header, values, timeZone));
        if (res.error || !res.id) {
          setError(res.error ?? "Could not save.");
          return;
        }
        id = res.id;
        setDocId(id);
      }
      if (lineCfg) {
        const remaining = [...lines];
        for (const line of lines) {
          const res = await saveLine(kind, id, null, toWire(lineCfg.fields, line.values, timeZone));
          if (res.error) {
            setLines(remaining);
            setError(`${res.error} The document was saved; fix the remaining items and Save again.`);
            return;
          }
          remaining.shift();
        }
      }
      router.push(`/m/stock/${kind}?saved=${encodeURIComponent(`${cfg.label} saved`)}`);
      router.refresh();
    });
  }

  function addLine() {
    if (!lineCfg || !adding) return;
    const found = validate(lineCfg.fields, adding);
    setLineErrors(found);
    if (Object.keys(found).length > 0) return;
    setLines((prev) => [...prev, { key: crypto.randomUUID(), values: adding }]);
    setAdding(null);
  }

  return (
    <div className="flex-1 px-4 pt-3 pb-[96px]">
      {error && <p className="mb-3 rounded-[8px] bg-[#fdedec] px-3 py-2 text-[16px] text-[#b42318]">{error}</p>}

      {cfg.header
        .filter((f) => !f.showWhen || f.showWhen(values))
        .map((f) => (
          <FieldInput
            key={f.key}
            idPrefix="h"
            field={f}
            value={values[f.key] ?? ""}
            options={options}
            error={errors[f.key]}
            onChange={(v) => setValues((prev) => ({ ...prev, [f.key]: v }))}
          />
        ))}

      {lineCfg && (
        <div className="mt-5">
          {lines.length > 0 && (
            <ul className="mb-3 overflow-hidden rounded-[8px] border border-[#dfe2e8] bg-white">
              {lines.map((l) => (
                <li key={l.key} className="flex items-start gap-3 border-b border-[#dfe2e8] px-3 py-2.5 last:border-b-0">
                  <div className="min-w-0 flex-1 text-[18px]">
                    {lineCfg.fields
                      .filter((f) => f.type !== "bool" || l.values[f.key] === "true")
                      .filter((f) => f.type !== "datetime")
                      .map((f) => (
                        <div key={f.key} className="flex justify-between gap-3">
                          <span className="text-[#5b6480]">{f.type === "bool" ? "" : f.label}</span>
                          <span className="text-right">{f.type === "bool" ? f.label : label(f, l.values[f.key])}</span>
                        </div>
                      ))}
                  </div>
                  <button
                    type="button"
                    aria-label="Remove item"
                    disabled={isPending}
                    onClick={() => setLines((prev) => prev.filter((p) => p.key !== l.key))}
                    className="mt-1 shrink-0"
                  >
                    <XIcon className="h-5 w-5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            disabled={isPending}
            className={`${mBtnDark} flex items-center gap-2`}
            onClick={() => {
              setLineErrors({});
              setAdding(initial(lineCfg.fields, timeZone));
            }}
          >
            <PlusIcon className="h-4 w-4" />
            Add Item
          </button>
        </div>
      )}

      <FormFooter>
        <button type="button" className={mBtnLight} disabled={isPending} onClick={() => setConfirmCancel(true)}>
          Cancel
        </button>
        <button type="button" className={kind === "transfers" ? mBtnDark : mBtnGreen} disabled={isPending} onClick={save}>
          {isPending ? "Saving…" : "Save"}
        </button>
      </FormFooter>

      <ConfirmDialog
        open={confirmCancel}
        onProceed={() => router.push(docId ? `/m/stock/${kind}` : "/m/stock")}
        onCancel={() => setConfirmCancel(false)}
      />

      {lineCfg && adding && (
        <Sheet
          title={`Add ${lineCfg.label}`}
          onClose={() => setAdding(null)}
          footer={
            <div className="flex w-full justify-between">
              <button type="button" className={mBtnLight} onClick={() => setAdding(null)}>
                Cancel
              </button>
              <button type="button" className={mBtnGreen} onClick={addLine}>
                Add
              </button>
            </div>
          }
        >
          <div className="p-4">
            {lineCfg.fields.map((f) => (
              <FieldInput
                key={f.key}
                idPrefix="l"
                field={f}
                value={adding[f.key] ?? ""}
                options={options}
                error={lineErrors[f.key]}
                onChange={(v) => setAdding((prev) => (prev ? { ...prev, [f.key]: v } : prev))}
              />
            ))}
          </div>
        </Sheet>
      )}
    </div>
  );
}
