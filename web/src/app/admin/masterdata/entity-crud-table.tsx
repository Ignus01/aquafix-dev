"use client";

import { useState, useTransition, type ReactNode } from "react";

export type FieldType = "text" | "number" | "boolean" | "select" | "date";

export interface FieldConfig {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: { value: string; label: string }[];
  render?: (value: string, row: Record<string, unknown>) => ReactNode;
  // Derived/system value — always read-only, never shown in a form.
  hideInForm?: boolean;
  // Shown in the edit form and table, but not the add form (e.g. a value the
  // server assigns automatically on create, like Grading's priority).
  editOnly?: boolean;
  // Value pre-filled in the Add form, matching the column's DB default
  // (e.g. "true" for `active`). Ignored once editing an existing row.
  defaultValue?: string;
}

export interface EntityCrudTableProps {
  fields: FieldConfig[];
  rows: Record<string, unknown>[];
  getId: (row: Record<string, unknown>) => string;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  onCreate: (values: Record<string, string>) => Promise<{ error: string | null }>;
  onUpdate: (
    id: string,
    values: Record<string, string>,
  ) => Promise<{ error: string | null }>;
  onDelete: (id: string) => Promise<{ error: string | null }>;
  emptyLabel?: string;
}

function initialValues(
  fields: FieldConfig[],
  row?: Record<string, unknown>,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const f of fields) {
    if (f.hideInForm) continue;
    const raw = row ? row[f.key] : undefined;
    if (raw === undefined && !row && f.defaultValue !== undefined) {
      values[f.key] = f.defaultValue;
    } else if (f.type === "boolean") {
      values[f.key] = String(Boolean(raw));
    } else {
      values[f.key] = raw === undefined || raw === null ? "" : String(raw);
    }
  }
  return values;
}

const inputClass =
  "w-full rounded-md border border-black/[.12] bg-transparent px-2.5 py-1.5 text-sm outline-none focus:border-zinc-950 dark:border-white/[.18] dark:focus:border-zinc-50";

function Field({
  field,
  value,
  onChange,
}: {
  field: FieldConfig;
  value: string;
  onChange: (v: string) => void;
}) {
  if (field.type === "boolean") {
    return (
      <label className="flex items-center gap-1.5 text-sm">
        <input
          type="checkbox"
          checked={value === "true"}
          onChange={(e) => onChange(String(e.target.checked))}
        />
        {field.label}
      </label>
    );
  }
  if (field.type === "select") {
    return (
      <select
        className={inputClass}
        value={value}
        required={field.required}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select…</option>
        {field.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      className={inputClass}
      type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
      value={value}
      required={field.required}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function EntityCrudTable({
  fields,
  rows,
  getId,
  canCreate,
  canUpdate,
  canDelete,
  onCreate,
  onUpdate,
  onDelete,
  emptyLabel,
}: EntityCrudTableProps) {
  const [adding, setAdding] = useState(false);
  const addFields = fields.filter((f) => !f.hideInForm && !f.editOnly);
  const editFields = fields.filter((f) => !f.hideInForm);

  const [addValues, setAddValues] = useState<Record<string, string>>(() =>
    initialValues(addFields),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function startEdit(row: Record<string, unknown>) {
    setEditingId(getId(row));
    setEditValues(initialValues(editFields, row));
    setError(null);
  }

  function submitAdd() {
    setError(null);
    startTransition(async () => {
      const res = await onCreate(addValues);
      if (res.error) setError(res.error);
      else {
        setAdding(false);
        setAddValues(initialValues(addFields));
      }
    });
  }

  function submitEdit() {
    if (!editingId) return;
    setError(null);
    startTransition(async () => {
      const res = await onUpdate(editingId, editValues);
      if (res.error) setError(res.error);
      else setEditingId(null);
    });
  }

  function handleDelete(row: Record<string, unknown>) {
    if (!confirm("Delete this record? This cannot be undone.")) return;
    setError(null);
    startTransition(async () => {
      const res = await onDelete(getId(row));
      if (res.error) setError(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/60 dark:text-red-300">
          {error}
        </p>
      )}

      {canCreate && (
        <div>
          {!adding ? (
            <button
              onClick={() => setAdding(true)}
              className="rounded-full bg-foreground px-4 py-1.5 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
            >
              + Add
            </button>
          ) : (
            <div className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {addFields.map((f) => (
                  <div key={f.key} className="flex flex-col gap-1">
                    {f.type !== "boolean" && (
                      <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                        {f.label}
                      </label>
                    )}
                    <Field
                      field={f}
                      value={addValues[f.key] ?? ""}
                      onChange={(v) =>
                        setAddValues((s) => ({ ...s, [f.key]: v }))
                      }
                    />
                  </div>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  disabled={isPending}
                  onClick={submitAdd}
                  className="rounded-full bg-foreground px-4 py-1.5 text-sm font-medium text-background disabled:opacity-60"
                >
                  {isPending ? "Saving…" : "Save"}
                </button>
                <button
                  disabled={isPending}
                  onClick={() => {
                    setAdding(false);
                    setError(null);
                  }}
                  className="rounded-full border border-black/[.12] px-4 py-1.5 text-sm dark:border-white/[.18]"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-black/[.08] dark:border-white/[.145]">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left dark:bg-zinc-900">
            <tr>
              {fields.map((f) => (
                <th key={f.key} className="px-3 py-2 font-medium whitespace-nowrap">
                  {f.label}
                </th>
              ))}
              {(canUpdate || canDelete) && (
                <th className="px-3 py-2 font-medium">Actions</th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={fields.length + 1}
                  className="px-3 py-6 text-center text-zinc-500"
                >
                  {emptyLabel ?? "No records yet."}
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const id = getId(row);
              const isEditing = editingId === id;
              return (
                <tr
                  key={id}
                  className="border-t border-black/[.08] dark:border-white/[.145]"
                >
                  {fields.map((f) => (
                    <td key={f.key} className="px-3 py-2 align-top">
                      {isEditing && !f.hideInForm ? (
                        <Field
                          field={f}
                          value={editValues[f.key] ?? ""}
                          onChange={(v) =>
                            setEditValues((s) => ({ ...s, [f.key]: v }))
                          }
                        />
                      ) : f.render ? (
                        f.render(String(row[f.key] ?? ""), row)
                      ) : f.type === "boolean" ? (
                        row[f.key] ? "Yes" : "No"
                      ) : (
                        String(row[f.key] ?? "") || "—"
                      )}
                    </td>
                  ))}
                  {(canUpdate || canDelete) && (
                    <td className="px-3 py-2 align-top whitespace-nowrap">
                      {isEditing ? (
                        <div className="flex gap-3">
                          <button
                            disabled={isPending}
                            onClick={submitEdit}
                            className="text-xs font-medium underline underline-offset-2"
                          >
                            Save
                          </button>
                          <button
                            disabled={isPending}
                            onClick={() => setEditingId(null)}
                            className="text-xs text-zinc-500 underline underline-offset-2"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-3">
                          {canUpdate && (
                            <button
                              onClick={() => startEdit(row)}
                              className="text-xs font-medium underline underline-offset-2"
                            >
                              Edit
                            </button>
                          )}
                          {canDelete && (
                            <button
                              disabled={isPending}
                              onClick={() => handleDelete(row)}
                              className="text-xs text-red-600 underline underline-offset-2 dark:text-red-400"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
