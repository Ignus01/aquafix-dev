"use client";

import { useState, useTransition, type ReactNode } from "react";
import type { CellValue } from "@/lib/grid/client-filter";
import { changedFields, YES_NO } from "@/lib/grid/fields";
import { BLANK, type ChoiceOption, type GridField, type GridSpec } from "@/lib/grid/types";
import { Drawer } from "../drawer";
import { Switch } from "../switch";
import { StatusBadge } from "../status-badge";
import { PlusIcon } from "../icons";
import { inputClass } from "../ui";
import { YesNo } from "../inspections/badges";
import { changedByOptions, changedColumns, Dash, type Changed, type GridColumn } from "../grid/columns";
import { Grid } from "../grid/grid";
import type { RowMenuItem } from "../grid/row-menu";

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
  // The table column's heading, when shorter than the form label.
  columnLabel?: string;
  // Number inputs: the step (e.g. "0.01").
  step?: string;
  // Replaces the built-in input; setValue can change any field of the form.
  renderInput?: (ctx: {
    value: string;
    values: Record<string, string>;
    setValue: (key: string, v: string) => void;
  }) => ReactNode;
  // Shown in the form only while this returns true.
  showIf?: (values: Record<string, string>) => boolean;
  // A form-only field: no grid column.
  hideInTable?: boolean;
}

// A lookup table's list: the shared <Grid> in client mode (every column
// filterable, the first column opens the record), with the add/edit drawer
// these small tables keep (D1). Rows carry changed_at / changed_by /
// changed_by_name from withChanged() (lib/grid/changed.ts).
export interface EntityCrudTableProps {
  // The grid's id (column choice and page size are remembered under it).
  gridId: string;
  // Only when a page shows two of these at once.
  prefix?: string;
  timeZone: string;
  // false when the table has updated_at but no updated_by: Changed only.
  changedBy?: boolean;
  // The grid's heading; defaults to the plural of itemLabel.
  title?: string;
  fields: FieldConfig[];
  rows: Record<string, unknown>[];
  getId: (row: Record<string, unknown>) => string;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  // Lets a read-only user open the record (and any drawer extra, which has its
  // own permissions) without being able to change its own fields.
  canView?: boolean;
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
      | { mode: "edit"; id: string; readOnly: boolean },
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
    } else if (raw !== null && typeof raw === "object") {
      values[f.key] = JSON.stringify(raw);
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
      step={field.step}
      value={value}
      required={field.required}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function FormFields({
  fields: allFields,
  values,
  onChange,
}: {
  fields: FieldConfig[];
  values: Record<string, string>;
  onChange: (key: string, v: string) => void;
}) {
  const fields = allFields.filter((f) => !f.showIf || f.showIf(values));
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
            {f.renderInput ? (
              f.renderInput({ value: values[f.key] ?? "", values, setValue: onChange })
            ) : (
              <Field
                field={f}
                value={values[f.key] ?? ""}
                onChange={(v) => onChange(f.key, v)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

const ACTIVE_OPTIONS: ChoiceOption[] = [
  { value: "true", label: "Active" },
  { value: "false", label: "Inactive" },
];

const isBlank = (v: unknown) => v === undefined || v === null || v === "";

// What the user sees for a select is the option's label, not the stored id,
// so sort by that.
function displayValue(f: FieldConfig, row: Record<string, unknown>): string {
  const raw = row[f.key];
  if (f.type === "select") {
    const label = f.options?.find((o) => o.value === raw)?.label;
    if (label !== undefined) return label;
  }
  return isBlank(raw) ? "" : typeof raw === "object" ? JSON.stringify(raw) : String(raw);
}

// The filtered (and exported) value: a select's id and a boolean's
// "true"/"false" match the choice filter's options.
function filterValue(f: FieldConfig, row: Record<string, unknown>): CellValue {
  const raw = row[f.key];
  if (f.type === "boolean") return String(Boolean(raw));
  if (f.type === "number") return isBlank(raw) ? null : Number(raw);
  if (f.type === "select") return isBlank(raw) ? null : String(raw);
  return displayValue(f, row);
}

function sortValue(f: FieldConfig, row: Record<string, unknown>): CellValue {
  if (f.type === "boolean") return Boolean(row[f.key]);
  if (f.type === "number") return filterValue(f, row);
  return displayValue(f, row);
}

function renderCell(f: FieldConfig, row: Record<string, unknown>) {
  const raw = row[f.key];
  if (f.render) return f.render(String(raw ?? ""), row);
  if (f.type === "boolean") {
    if (f.statusBadge) return <StatusBadge active={Boolean(raw)} />;
    return <YesNo value={Boolean(raw)} />;
  }
  if (f.type === "select") {
    const text = displayValue(f, row);
    return text || <Dash />;
  }
  if (isBlank(raw)) return <Dash />;
  if (f.mono) {
    return <span className="font-mono text-[13px] text-muted">{String(raw)}</span>;
  }
  return String(raw);
}

function gridField(f: FieldConfig, first: boolean): GridField {
  const label = f.columnLabel ?? f.label;
  const base = { key: f.key, label, hideable: !first };
  switch (f.type) {
    case "text":
      return { ...base, filter: "text" };
    case "number":
      return { ...base, filter: "number" };
    case "date":
      return { ...base, filter: "date" };
    case "boolean":
      return { ...base, filter: "choice", options: f.statusBadge ? ACTIVE_OPTIONS : YES_NO };
    case "select":
      return {
        ...base,
        filter: "choice",
        options: [...(f.options ?? []), ...(f.required ? [] : [{ value: BLANK, label: "Not set" }])],
      };
  }
}

type Row = Record<string, unknown> & Partial<Changed>;

export function EntityCrudTable({
  gridId,
  prefix,
  timeZone,
  changedBy = true,
  fields,
  rows,
  getId,
  canCreate,
  canUpdate,
  canDelete,
  canView = false,
  onCreate,
  onUpdate,
  onDelete,
  emptyLabel,
  itemLabel,
  title,
  customEditor,
  renderDrawerExtra,
}: EntityCrudTableProps) {
  const addFields = fields.filter((f) => !f.hideInForm && !f.editOnly);
  const editFields = fields.filter((f) => !f.hideInForm);
  const tableFields = fields.filter((f) => !f.hideInTable);

  const [drawer, setDrawer] = useState<
    | { mode: "add"; values: Record<string, string> }
    | { mode: "edit"; id: string; values: Record<string, string> }
    | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [tableError, setTableError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const canOpen = canUpdate || canView || customEditor !== undefined;

  // The first column (the legacy UID where the table has one) is the ID: it
  // opens the record in the drawer. Changed / Changed by come last.
  const spec: GridSpec = {
    id: gridId,
    fields: [
      ...tableFields.map((f, i) => gridField(f, i === 0)),
      ...(changedBy ? changedFields() : changedFields().slice(0, 1)),
    ],
    defaultSort: { key: "changed", desc: true },
    changedException: changedBy ? undefined : "The table has no updated_by column.",
  };

  const columns: GridColumn<Row>[] = [
    ...tableFields.map(
      (f, i): GridColumn<Row> => ({
        key: f.key,
        // The ID cell is a link-styled button; it gets the plain value.
        render: i === 0 && !f.render ? (r) => displayValue(f, r) || "—" : (r) => renderCell(f, r),
        value: (r) => filterValue(f, r),
        sortValue: (r) => sortValue(f, r),
        align: f.type === "number" && i > 0 ? "right" : undefined,
      }),
    ),
    ...changedColumns<Row & Changed>(timeZone).slice(0, changedBy ? 2 : 1),
  ] as GridColumn<Row>[];

  function openAdd() {
    setError(null);
    setDrawer({ mode: "add", values: initialValues(addFields) });
  }

  function openEdit(row: Record<string, unknown>) {
    if (customEditor) {
      customEditor.onOpen(row);
      return;
    }
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

  function menu(row: Row): RowMenuItem[] {
    const items: RowMenuItem[] = [];
    if (canOpen) items.push({ label: canUpdate ? "Edit" : "View", onSelect: () => openEdit(row) });
    if (canDelete) {
      items.push({
        label: "Delete",
        danger: true,
        confirm: `Delete this ${itemLabel.toLowerCase()}? This can't be undone.`,
        onSelect: async () => {
          setTableError(null);
          const res = await onDelete(getId(row));
          if (res.error) setTableError(res.error);
        },
      });
    }
    return items;
  }

  const first = tableFields[0];

  return (
    <div className="flex flex-col gap-3">
      {tableError && (
        <p className="border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">
          {tableError}
        </p>
      )}

      <Grid
        mode="client"
        spec={spec}
        rows={rows as Row[]}
        columns={columns}
        getKey={(r) => getId(r)}
        title={title ?? `${itemLabel}s`}
        timeZone={timeZone}
        prefix={prefix}
        onRowOpen={canOpen ? openEdit : undefined}
        rowLabel={(r) => `${itemLabel.toLowerCase()} ${first ? displayValue(first, r) : getId(r)}`}
        rowMenu={menu}
        options={changedBy ? { changed_by: changedByOptions(rows as Row[] as Changed[]) } : undefined}
        emptyLabel={emptyLabel ?? "No records yet."}
        primaryAction={
          canCreate && (
            <button
              type="button"
              onClick={customEditor ? customEditor.onAdd : openAdd}
              className="flex h-[38px] items-center gap-2 rounded-control bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
            >
              <PlusIcon className="h-4 w-4" />
              New {itemLabel.toLowerCase()}
            </button>
          )
        }
      />

      <Drawer
        open={drawer !== null}
        title={
          drawer?.mode === "edit"
            ? `${canUpdate ? "Edit" : "View"} ${itemLabel}`
            : `New ${itemLabel}`
        }
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
            {(drawer?.mode !== "edit" || canUpdate) && (
              <button
                disabled={isPending}
                onClick={submit}
                className="h-[40px] rounded-control bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
              >
                {isPending ? "Saving…" : "Save"}
              </button>
            )}
          </>
        }
      >
        {error && (
          <p className="mb-4 border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">
            {error}
          </p>
        )}
        {drawer && (
          <fieldset disabled={drawer.mode === "edit" && !canUpdate} className="min-w-0">
            <FormFields
              fields={drawer.mode === "add" ? addFields : editFields}
              values={drawer.values}
              onChange={setFieldValue}
            />
          </fieldset>
        )}
        {drawer &&
          renderDrawerExtra?.(
            drawer.mode === "add"
              ? { mode: "add", saveFirst }
              : { mode: "edit", id: drawer.id, readOnly: !canUpdate },
          )}
      </Drawer>
    </div>
  );
}
