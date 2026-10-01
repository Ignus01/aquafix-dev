"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { formatDate, formatDateTime } from "@/lib/incidents/format";
import {
  DOC_CONFIG,
  docNumber,
  type DocKind,
  type Extra,
  type Field,
  type Options,
} from "@/lib/stock-manager/docs";
import type { DocData, DocRow } from "@/lib/stock-manager/types";
import { PlusIcon } from "../icons";
import { Modal } from "../modal";
import {
  dangerLinkButtonClass,
  inputClass,
  labelClass,
  linkButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
  sectionHeadingClass,
  smallPrimaryButtonClass,
  tableHeadCellClass,
} from "../ui";
import { deleteDocument, deleteLine, saveHeader, saveLine } from "./actions";
import { PoStatusBadge, formatMoney, formatQty } from "./format";

type Values = Record<string, string>;

const pad = (n: number) => String(n).padStart(2, "0");

// <input type="datetime-local"> works in the browser's local time.
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function initialValues(fields: Field[], row: DocRow | null): Values {
  const v: Values = {};
  for (const f of fields) {
    const raw = row?.[f.key];
    if (raw !== null && raw !== undefined && typeof raw !== "object") {
      v[f.key] = f.type === "datetime" && raw !== "" ? toLocalInput(String(raw)) : String(raw);
    } else if (!row && f.type === "date" && f.required) v[f.key] = today();
    else if (!row && f.type === "datetime") v[f.key] = toLocalInput(new Date().toISOString());
    else if (f.type === "bool") v[f.key] = "false";
    else if (!row && f.key === "status") v[f.key] = "new";
    else v[f.key] = "";
  }
  return v;
}

// Browser-local datetime -> ISO, so the database gets an absolute instant.
function outgoing(fields: Field[], values: Values): Values {
  const out = { ...values };
  for (const f of fields) {
    if (f.type === "datetime" && out[f.key]) out[f.key] = new Date(out[f.key]).toISOString();
  }
  return out;
}

function FieldInputs({
  fields,
  values,
  setValue,
  options,
  disabled,
  mode,
}: {
  fields: Field[];
  values: Values;
  setValue: (key: string, value: string) => void;
  options: Options;
  disabled: boolean;
  mode: "create" | "update";
}) {
  return (
    <>
      {fields
        .filter((f) => !f.readOnly && !(f.showWhen && !f.showWhen(values)))
        .map((f) => {
          const off = disabled || (mode === "update" && f.createOnly);
          return (
            <label key={f.key} className="flex flex-col gap-1.5">
              <span className={labelClass}>
                {f.label}
                {f.required && <span className="text-danger"> *</span>}
              </span>
              {f.type === "select" ? (
                <select
                  className={inputClass}
                  value={values[f.key] ?? ""}
                  disabled={off}
                  onChange={(e) => setValue(f.key, e.target.value)}
                >
                  <option value="">Select…</option>
                  {options[f.options!].map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : f.type === "textarea" ? (
                <textarea
                  className={`${inputClass} h-20 py-2`}
                  value={values[f.key] ?? ""}
                  disabled={off}
                  onChange={(e) => setValue(f.key, e.target.value)}
                />
              ) : f.type === "bool" ? (
                <input
                  type="checkbox"
                  className="h-4 w-4 self-start"
                  checked={values[f.key] === "true"}
                  disabled={off}
                  onChange={(e) => setValue(f.key, String(e.target.checked))}
                />
              ) : (
                <input
                  className={inputClass}
                  type={f.type === "datetime" ? "datetime-local" : f.type === "number" ? "number" : f.type}
                  step={f.type === "number" ? "any" : undefined}
                  value={values[f.key] ?? ""}
                  disabled={off}
                  onChange={(e) => setValue(f.key, e.target.value)}
                />
              )}
              {f.hint && <span className="text-xs text-muted">{f.hint}</span>}
            </label>
          );
        })}
    </>
  );
}

function ExtraValue({ extra, row }: { extra: Extra; row: DocRow }) {
  const v = row[extra.key];
  if (extra.kind === "status") return <PoStatusBadge status={String(v)} />;
  if (extra.kind === "money") return <>{formatMoney(v as number)}</>;
  const n = Number(v);
  if (extra.key === "qty_outstanding" && n < 0) {
    return (
      <span className="text-warning" title="Received more than was ordered">
        {formatQty(n)} (over-received)
      </span>
    );
  }
  return <>{formatQty(v as number)}</>;
}

export function DocEditor({
  kind,
  doc,
  options,
  timeZone,
  rights,
  loadReference,
  children,
}: {
  kind: DocKind;
  doc: DocData | null;
  options: Options;
  timeZone: string;
  rights: { update: boolean; delete: boolean; lineCreate: boolean; lineDelete: boolean };
  // New intake: the load it arrives on.
  loadReference?: number;
  // Panels between the header and the lines (documents, intake PO lines…).
  children?: ReactNode;
}) {
  const cfg = DOC_CONFIG[kind];
  const router = useRouter();
  const isNew = !doc;
  const [values, setValues] = useState<Values>(() => initialValues(cfg.header, doc?.header ?? null));
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const canEditHeader = isNew ? true : rights.update;

  function setValue(key: string, value: string) {
    setValues((v) => ({ ...v, [key]: value }));
  }

  function save() {
    setMessage(null);
    startTransition(async () => {
      const res = await saveHeader(kind, doc?.header.id ?? null, outgoing(cfg.header, values), { loadReference });
      if (res.error) {
        setMessage({ error: true, text: res.error });
        return;
      }
      if (isNew && res.reference !== undefined) {
        router.replace(`/admin/stock-manager/${kind}/${res.reference}`);
      } else {
        setMessage({ error: false, text: "Saved." });
        router.refresh();
      }
    });
  }

  function remove() {
    if (!doc || !window.confirm(`Delete ${cfg.label.toLowerCase()} ${docNumber(kind, doc.header.reference)}? Its lines and stock movements are deleted too.`)) return;
    setMessage(null);
    startTransition(async () => {
      const res = await deleteDocument(kind, doc.header.id);
      if (res.error) setMessage({ error: true, text: res.error });
      else router.replace(`/admin/stock-manager?tab=${kind}`);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-card border border-border bg-card p-5">
        {doc && cfg.headerExtras.length > 0 && (
          <dl className="mb-5 flex flex-wrap gap-x-8 gap-y-2 border-b border-border pb-4">
            {cfg.headerExtras.map((e) => (
              <div key={e.key} className="flex flex-col gap-0.5">
                <dt className={sectionHeadingClass}>{e.label}</dt>
                <dd className="text-sm font-semibold text-ink">
                  <ExtraValue extra={e} row={doc.header} />
                </dd>
              </div>
            ))}
          </dl>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <FieldInputs
            fields={cfg.header}
            values={values}
            setValue={setValue}
            options={options}
            disabled={!canEditHeader || isPending}
            mode={isNew ? "create" : "update"}
          />
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {canEditHeader && (
            <button type="button" onClick={save} disabled={isPending} className={primaryButtonClass}>
              {isNew ? `Create ${cfg.label.toLowerCase()}` : "Save"}
            </button>
          )}
          {doc && rights.delete && (
            <button type="button" onClick={remove} disabled={isPending} className={dangerLinkButtonClass}>
              Delete {cfg.label.toLowerCase()}
            </button>
          )}
          {message && (
            <span className={`text-sm ${message.error ? "text-danger" : "text-success"}`} role={message.error ? "alert" : "status"}>
              {message.text}
            </span>
          )}
        </div>
        {isNew && cfg.line && (
          <p className="mt-3 text-xs text-muted">Lines can be added once the {cfg.label.toLowerCase()} is created.</p>
        )}
      </section>

      {doc && children}

      {doc && cfg.line && (
        <LinesPanel
          kind={kind}
          doc={doc}
          options={options}
          timeZone={timeZone}
          canEdit={rights.update}
          canAdd={rights.lineCreate}
          canDelete={rights.lineDelete}
        />
      )}
    </div>
  );
}

function cellText(f: Field, row: DocRow, options: Options, timeZone: string): string {
  const v = row[f.key];
  if (v === null || v === undefined || v === "") return "—";
  switch (f.type) {
    case "select":
      return options[f.options!].find((o) => o.value === v)?.label ?? "—";
    case "date":
      return formatDate(String(v), timeZone);
    case "datetime":
      return formatDateTime(String(v), timeZone);
    case "bool":
      return v === true ? "Yes" : "No";
    case "number":
      return f.key.startsWith("unit_cost") ? formatMoney(v as number) : formatQty(v as number);
    default:
      return String(v);
  }
}

function LinesPanel({
  kind,
  doc,
  options,
  timeZone,
  canEdit,
  canAdd,
  canDelete,
}: {
  kind: DocKind;
  doc: DocData;
  options: Options;
  timeZone: string;
  canEdit: boolean;
  canAdd: boolean;
  canDelete: boolean;
}) {
  const line = DOC_CONFIG[kind].line!;
  const router = useRouter();
  const [editing, setEditing] = useState<{ row: DocRow | null } | null>(null);
  const [values, setValues] = useState<Values>({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function open(row: DocRow | null) {
    setValues(initialValues(line.fields, row));
    setError(null);
    setEditing({ row });
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await saveLine(kind, doc.header.id, editing?.row?.id ?? null, outgoing(line.fields, values));
      if (res.error) {
        setError(res.error);
        return;
      }
      setEditing(null);
      router.refresh();
    });
  }

  function remove(row: DocRow) {
    if (!window.confirm("Delete this line? Its stock movement is removed too.")) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteLine(kind, row.id);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  const showAdd = canAdd && !line.noAdd;
  const hasActions = canEdit || canDelete;

  return (
    <section className="rounded-card border border-border bg-card">
      <div className="flex items-center justify-between px-5 py-4">
        <h2 className={sectionHeadingClass}>{line.plural}</h2>
        {showAdd && (
          <button type="button" onClick={() => open(null)} className={smallPrimaryButtonClass}>
            <PlusIcon className="h-3.5 w-3.5" />
            Add {line.label.toLowerCase()}
          </button>
        )}
      </div>
      {error && !editing && (
        <p className="px-5 pb-3 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="overflow-x-auto border-t border-border">
        <table className="w-full text-sm">
          <thead className="bg-table-head">
            <tr>
              {line.fields.map((f) => (
                <th key={f.key} className={tableHeadCellClass}>
                  {f.label}
                </th>
              ))}
              {line.extras.map((e) => (
                <th key={e.key} className={tableHeadCellClass}>
                  {e.label}
                </th>
              ))}
              {hasActions && <th className={tableHeadCellClass} />}
            </tr>
          </thead>
          <tbody>
            {doc.lines.length === 0 && (
              <tr>
                <td colSpan={line.fields.length + line.extras.length + 1} className="px-3 py-8 text-center text-muted">
                  No {line.plural.toLowerCase()} yet.
                </td>
              </tr>
            )}
            {doc.lines.map((row) => (
              <tr key={row.id} className="border-t border-border hover:bg-row-hover">
                {line.fields.map((f) => (
                  <td key={f.key} className="px-3 py-2.5 text-ink">
                    {cellText(f, row, options, timeZone)}
                  </td>
                ))}
                {line.extras.map((e) => (
                  <td key={e.key} className="px-3 py-2.5 text-ink tabular-nums">
                    <ExtraValue extra={e} row={row} />
                  </td>
                ))}
                {hasActions && (
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    <span className="flex justify-end gap-3">
                      {canEdit && (
                        <button type="button" onClick={() => open(row)} className={linkButtonClass}>
                          Edit
                        </button>
                      )}
                      {canDelete && (
                        <button type="button" onClick={() => remove(row)} disabled={isPending} className={dangerLinkButtonClass}>
                          Delete
                        </button>
                      )}
                    </span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={editing !== null}
        title={`${editing?.row ? "Edit" : "Add"} ${line.label.toLowerCase()}`}
        onClose={() => setEditing(null)}
        footer={
          <>
            <button type="button" onClick={() => setEditing(null)} className={secondaryButtonClass}>
              Cancel
            </button>
            <button type="button" onClick={submit} disabled={isPending} className={primaryButtonClass}>
              Save
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <FieldInputs
            fields={line.fields}
            values={values}
            setValue={(k, v) => setValues((s) => ({ ...s, [k]: v }))}
            options={options}
            disabled={isPending}
            mode={editing?.row ? "update" : "create"}
          />
          {error && (
            <p className="text-sm text-danger" role="alert">
              {error}
            </p>
          )}
        </div>
      </Modal>
    </section>
  );
}
