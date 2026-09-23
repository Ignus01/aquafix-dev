"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { Drawer } from "../drawer";
import { Switch } from "../switch";
import { StatusBadge } from "../status-badge";
import { SearchIcon, PlusIcon } from "../icons";
import { inputClass } from "../ui";

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
  // Render as a coloured status pill instead of Yes/No (boolean fields only).
  statusBadge?: boolean;
  // Render in monospace, muted, small (asset codes / legacy UIDs).
  mono?: boolean;
  // Groups consecutive fields under an uppercase section heading in the drawer form.
  section?: string;
}

export interface EntityCrudTableProps {
  fields: FieldConfig[];
  rows: Record<string, unknown>[];
  getId: (row: Record<string, unknown>) => string;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  // Returning the new row's id lets renderDrawerExtra's saveFirst() keep the
  // drawer open in edit mode after creating.
  onCreate: (
    values: Record<string, string>,
  ) => Promise<{ error: string | null; id?: string }>;
  onUpdate: (
    id: string,
    values: Record<string, string>,
  ) => Promise<{ error: string | null }>;
  onDelete: (id: string) => Promise<{ error: string | null }>;
  emptyLabel?: string;
  itemLabel: string;
  // Replaces the built-in add/edit drawer with the caller's own editor. The
  // row action becomes "Edit" when canUpdate, otherwise "View".
  customEditor?: {
    onAdd: () => void;
    onOpen: (row: Record<string, unknown>) => void;
  };
  // Extra content rendered below the built-in drawer form (e.g. a child grid).
  // In add mode, saveFirst() creates the row and switches the drawer to edit
  // mode, resolving to the new id (null on validation failure).
  renderDrawerExtra?: (
    ctx:
      | { mode: "add"; saveFirst: () => Promise<string | null> }
      | { mode: "edit"; id: string },
  ) => ReactNode;
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
      <Switch
        label={field.label}
        checked={value === "true"}
        onChange={(v) => onChange(String(v))}
      />
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

function FormFields({
  fields,
  values,
  onChange,
}: {
  fields: FieldConfig[];
  values: Record<string, string>;
  onChange: (key: string, v: string) => void;
}) {
  const sectionStarts = fields.map(
    (f, i) => f.section !== undefined && f.section !== fields[i - 1]?.section,
  );

  return (
    <div className="flex flex-col gap-4">
      {fields.map((f, i) => {
        const showSection = sectionStarts[i];
        return (
          <div key={f.key} className="flex flex-col gap-1.5">
            {showSection && (
              <div className="mt-2 mb-1 text-[11px] font-semibold tracking-wider text-muted uppercase first:mt-0">
                {f.section}
              </div>
            )}
            {f.type !== "boolean" && (
              <label className="text-xs font-medium text-muted">
                {f.label}
              </label>
            )}
            <Field
              field={f}
              value={values[f.key] ?? ""}
              onChange={(v) => onChange(f.key, v)}
            />
          </div>
        );
      })}
    </div>
  );
}

function renderCell(f: FieldConfig, row: Record<string, unknown>) {
  const raw = row[f.key];
  if (f.render) return f.render(String(raw ?? ""), row);
  if (f.type === "boolean") {
    if (f.statusBadge) return <StatusBadge active={Boolean(raw)} />;
    return <Switch checked={Boolean(raw)} onChange={() => {}} />;
  }
  const text = raw === undefined || raw === null || raw === "" ? "—" : String(raw);
  if (f.mono) {
    return <span className="font-mono text-[13px] text-muted">{text}</span>;
  }
  return text;
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
  itemLabel,
  customEditor,
  renderDrawerExtra,
}: EntityCrudTableProps) {
  const addFields = fields.filter((f) => !f.hideInForm && !f.editOnly);
  const editFields = fields.filter((f) => !f.hideInForm);
  const hasActiveField = fields.some((f) => f.key === "active" && f.statusBadge);

  const [query, setQuery] = useState("");
  const [activeOnly, setActiveOnly] = useState(false);

  const [drawer, setDrawer] = useState<
    | { mode: "add"; values: Record<string, string> }
    | { mode: "edit"; id: string; values: Record<string, string> }
    | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [tableError, setTableError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const showActions = canUpdate || canDelete || customEditor !== undefined;

  const filteredRows = useMemo(() => {
    let list = rows;
    if (activeOnly) list = list.filter((r) => Boolean(r.active));
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((r) =>
        fields.some((f) => {
          if (f.type === "boolean") return false;
          return String(r[f.key] ?? "").toLowerCase().includes(q);
        }),
      );
    }
    return list;
  }, [rows, query, activeOnly, fields]);

  function openAdd() {
    setError(null);
    setDrawer({ mode: "add", values: initialValues(addFields) });
  }

  function openEdit(row: Record<string, unknown>) {
    setError(null);
    setDrawer({ mode: "edit", id: getId(row), values: initialValues(editFields, row) });
  }

  function setFieldValue(key: string, v: string) {
    setDrawer((d) => (d ? { ...d, values: { ...d.values, [key]: v } } : d));
  }

  function submit() {
    if (!drawer) return;
    setError(null);
    startTransition(async () => {
      const res =
        drawer.mode === "add"
          ? await onCreate(drawer.values)
          : await onUpdate(drawer.id, drawer.values);
      if (res.error) setError(res.error);
      else setDrawer(null);
    });
  }

  async function saveFirst(): Promise<string | null> {
    if (!drawer || drawer.mode !== "add") return null;
    setError(null);
    const res = await onCreate(drawer.values);
    if (res.error || !res.id) {
      setError(res.error ?? "Could not save.");
      return null;
    }
    setDrawer({ mode: "edit", id: res.id, values: drawer.values });
    return res.id;
  }

  function handleDelete(row: Record<string, unknown>) {
    if (!confirm(`Delete this ${itemLabel.toLowerCase()}? This cannot be undone.`)) return;
    setTableError(null);
    startTransition(async () => {
      const res = await onDelete(getId(row));
      if (res.error) setTableError(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <label className="flex h-[38px] w-72 items-center gap-2 rounded-full border border-border bg-white px-3 text-muted">
          <SearchIcon className="h-4 w-4 shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${itemLabel.toLowerCase()}s…`}
            className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted"
          />
        </label>

        {hasActiveField && (
          <button
            type="button"
            onClick={() => setActiveOnly((v) => !v)}
            className={`flex h-[38px] items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium transition-colors ${
              activeOnly
                ? "border-primary bg-primary/10 text-primary-hover"
                : "border-border bg-white text-ink hover:bg-black/[.02]"
            }`}
          >
            Active only
          </button>
        )}

        <div className="flex-1" />

        {canCreate && (
          <button
            onClick={customEditor ? customEditor.onAdd : openAdd}
            className="flex h-[38px] items-center gap-2 rounded-control bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
          >
            <PlusIcon className="h-4 w-4" />
            New {itemLabel.toLowerCase()}
          </button>
        )}
      </div>

      {tableError && (
        <p className="border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">
          {tableError}
        </p>
      )}

      <div className="overflow-x-auto rounded-card border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-table-head">
              {fields.map((f) => (
                <th
                  key={f.key}
                  className="px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider text-muted uppercase whitespace-nowrap"
                >
                  {f.label}
                </th>
              ))}
              {showActions && (
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider text-muted uppercase">
                  Actions
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 && (
              <tr>
                <td
                  colSpan={fields.length + 1}
                  className="px-4 py-8 text-center text-muted"
                >
                  {rows.length === 0 ? (emptyLabel ?? "No records yet.") : "No matches."}
                </td>
              </tr>
            )}
            {filteredRows.map((row) => {
              const id = getId(row);
              return (
                <tr
                  key={id}
                  className="h-[50px] border-t border-border transition-colors hover:bg-row-hover"
                >
                  {fields.map((f) => (
                    <td key={f.key} className="px-4 text-ink">
                      {renderCell(f, row)}
                    </td>
                  ))}
                  {showActions && (
                    <td className="px-4 whitespace-nowrap">
                      <div className="flex gap-4">
                        {customEditor ? (
                          <button
                            onClick={() => customEditor.onOpen(row)}
                            className="text-xs font-semibold text-primary hover:text-primary-hover"
                          >
                            {canUpdate ? "Edit" : "View"}
                          </button>
                        ) : (
                          canUpdate && (
                            <button
                              onClick={() => openEdit(row)}
                              className="text-xs font-semibold text-primary hover:text-primary-hover"
                            >
                              Edit
                            </button>
                          )
                        )}
                        {canDelete && (
                          <button
                            disabled={isPending}
                            onClick={() => handleDelete(row)}
                            className="text-xs font-semibold text-danger hover:opacity-80"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Drawer
        open={drawer !== null}
        title={drawer?.mode === "edit" ? `Edit ${itemLabel}` : `New ${itemLabel}`}
        onClose={() => setDrawer(null)}
        footer={
          <>
            <button
              disabled={isPending}
              onClick={() => setDrawer(null)}
              className="h-[40px] rounded-control border border-border bg-white px-4 text-sm font-medium text-ink transition-colors hover:bg-black/[.02] disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              disabled={isPending}
              onClick={submit}
              className="h-[40px] rounded-control bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
            >
              {isPending ? "Saving…" : "Save"}
            </button>
          </>
        }
      >
        {error && (
          <p className="mb-4 border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">
            {error}
          </p>
        )}
        {drawer && (
          <FormFields
            fields={drawer.mode === "add" ? addFields : editFields}
            values={drawer.values}
            onChange={setFieldValue}
          />
        )}
        {drawer &&
          renderDrawerExtra?.(
            drawer.mode === "add"
              ? { mode: "add", saveFirst }
              : { mode: "edit", id: drawer.id },
          )}
      </Drawer>
    </div>
  );
}
