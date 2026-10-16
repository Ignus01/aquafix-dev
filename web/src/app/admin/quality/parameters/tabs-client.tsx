"use client";

import { useState } from "react";
import { rangeText } from "@/lib/quality/evaluate";
import type { Lab, LabLocationMap, LabParameterMap, QualityParameter } from "@/lib/quality/types";
import { EntityCrudTable, type FieldConfig } from "../../masterdata/entity-crud-table";
import { inputClass } from "../../ui";
import * as actions from "./actions";

type TabKey = "parameters" | "parameter_maps" | "location_maps" | "labs";

const activeField: FieldConfig = {
  key: "active",
  label: "Active",
  type: "boolean",
  defaultValue: "true",
  statusBadge: true,
};

// A value that identifies the row and can't be changed here.
const readOnly = (text: string) => <div className={`${inputClass} flex items-center bg-table-head text-muted`}>{text || "—"}</div>;

const mono = (v: string) => <span className="font-mono text-[13px]">{v || "—"}</span>;
const ignored = <span className="text-muted italic">Ignored</span>;

export function ParametersTabs({
  canEdit,
  parameters,
  parameterMaps,
  locationMaps,
  labs,
  locations,
}: {
  canEdit: boolean;
  parameters: QualityParameter[];
  parameterMaps: LabParameterMap[];
  locationMaps: LabLocationMap[];
  labs: Lab[];
  locations: { id: string; name: string; active: boolean }[];
}) {
  const [tab, setTab] = useState<TabKey>("parameters");
  const perms = { canCreate: canEdit, canUpdate: canEdit, canDelete: canEdit };

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: "parameters", label: "Parameters", count: parameters.length },
    { key: "parameter_maps", label: "Lab parameter mappings", count: parameterMaps.length },
    { key: "location_maps", label: "Lab location mappings", count: locationMaps.length },
    { key: "labs", label: "Labs", count: labs.length },
  ];

  const labName = new Map(labs.map((l) => [l.id, l.name]));
  const labOptions = labs.map((l) => ({ value: l.id, label: l.name }));
  const paramById = new Map(parameters.map((p) => [p.id, p]));
  const paramLabel = (p: QualityParameter) => `${p.name} (${p.unit})`;
  const locationName = new Map(locations.map((l) => [l.id, l.name]));

  return (
    <div className="px-4 pb-10 md:px-8">
      <div className="mb-6 flex flex-wrap gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
              tab === t.key ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {t.label}
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${
                tab === t.key ? "bg-primary/10 text-primary" : "bg-black/[.04] text-muted"
              }`}
            >
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {tab === "parameters" && (
        <EntityCrudTable
          rows={parameters}
          getId={(r) => r.id as string}
          {...perms}
          canView
          itemLabel="Parameter"
          emptyLabel="No parameters yet."
          onCreate={actions.createParameter}
          onUpdate={actions.updateParameter}
          onDelete={actions.deleteParameter}
          fields={
            [
              { key: "name", label: "Name", type: "text", required: true, section: "Parameter" },
              { key: "short_name", label: "Short name", type: "text" },
              { key: "unit", label: "Unit", type: "text", required: true },
              {
                key: "range",
                label: "Acceptable",
                type: "text",
                hideInForm: true,
                render: (_v, row) => mono(rangeText(row as unknown as QualityParameter)),
              },
              { key: "min_acceptable", label: "Min acceptable", type: "number", step: "any", hideInTable: true, section: "Acceptable levels" },
              { key: "max_acceptable", label: "Max acceptable", type: "number", step: "any", hideInTable: true },
              { key: "standard", label: "Standard", type: "text" },
              { key: "can_be_negative", label: "Can be negative", type: "boolean", section: "Values" },
              { key: "decimals", label: "Decimals", type: "number", step: "1", defaultValue: "2" },
              { key: "sort_order", label: "Order", type: "number", step: "1", editOnly: true },
              { ...activeField, section: "Status" },
            ] satisfies FieldConfig[]
          }
        />
      )}

      {tab === "parameter_maps" && (
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-muted">
            Mappings are saved by imports, once per lab. Editing one affects future imports only; past results keep their
            parameter.
          </p>
          <EntityCrudTable
            rows={parameterMaps}
            getId={(r) => r.id as string}
            {...perms}
            canCreate={false}
            itemLabel="Mapping"
            emptyLabel="No mappings yet. They're added when you import a lab's first file."
            onCreate={async () => ({ error: "Mappings are added by importing a file." })}
            onUpdate={actions.updateParameterMap}
            onDelete={actions.deleteParameterMap}
            fields={
              [
                {
                  key: "lab_id",
                  label: "Lab",
                  type: "select",
                  options: labOptions,
                  filter: true,
                  renderInput: ({ value }) => readOnly(labName.get(value) ?? ""),
                },
                {
                  key: "lab_parameter",
                  label: "Lab parameter",
                  type: "text",
                  mono: true,
                  renderInput: ({ value }) => readOnly(value),
                },
                { key: "lab_unit", label: "Lab unit", type: "text" },
                {
                  key: "parameter_id",
                  label: "Parameter",
                  type: "select",
                  options: parameters.map((p) => ({ value: p.id, label: paramLabel(p) })),
                  render: (v) => {
                    const p = paramById.get(v);
                    return p ? paramLabel(p) : ignored;
                  },
                  renderInput: ({ value, setValue }) => (
                    <select className={inputClass} value={value} onChange={(e) => setValue("parameter_id", e.target.value)}>
                      <option value="">Ignore this column</option>
                      {parameters
                        .filter((p) => p.active || p.id === value)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {paramLabel(p)}
                          </option>
                        ))}
                    </select>
                  ),
                },
                {
                  key: "factor",
                  label: "Factor",
                  type: "number",
                  step: "any",
                  showIf: (values) => Boolean(values.parameter_id),
                  render: (v, row) => (row.parameter_id ? mono(v) : "—"),
                },
              ] satisfies FieldConfig[]
            }
          />
        </div>
      )}

      {tab === "location_maps" && (
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-muted">
            Mappings are saved by imports, once per lab. Editing one affects future imports only; past samples keep their
            location.
          </p>
          <EntityCrudTable
            rows={locationMaps}
            getId={(r) => r.id as string}
            {...perms}
            canCreate={false}
            itemLabel="Mapping"
            emptyLabel="No mappings yet. They're added when you import a lab's first file."
            onCreate={async () => ({ error: "Mappings are added by importing a file." })}
            onUpdate={actions.updateLocationMap}
            onDelete={actions.deleteLocationMap}
            fields={
              [
                {
                  key: "lab_id",
                  label: "Lab",
                  type: "select",
                  options: labOptions,
                  filter: true,
                  renderInput: ({ value }) => readOnly(labName.get(value) ?? ""),
                },
                {
                  key: "lab_locality",
                  label: "Lab locality",
                  type: "text",
                  renderInput: ({ value }) => readOnly(value),
                },
                {
                  key: "location_id",
                  label: "Location",
                  type: "select",
                  options: locations.map((l) => ({ value: l.id, label: l.name })),
                  render: (v) => locationName.get(v) ?? ignored,
                  renderInput: ({ value, setValue }) => (
                    <select className={inputClass} value={value} onChange={(e) => setValue("location_id", e.target.value)}>
                      <option value="">Ignore (skip these samples)</option>
                      {locations
                        .filter((l) => l.active || l.id === value)
                        .map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                    </select>
                  ),
                },
              ] satisfies FieldConfig[]
            }
          />
        </div>
      )}

      {tab === "labs" && (
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-muted">
            Labs are added by imports, matched on the lab name at the top of the certificate. Rename one here if needed.
          </p>
          <EntityCrudTable
            rows={labs}
            getId={(r) => r.id as string}
            {...perms}
            itemLabel="Lab"
            emptyLabel="No labs yet. A lab is added when you import its first file."
            onCreate={actions.createLab}
            onUpdate={actions.updateLab}
            onDelete={actions.deleteLab}
            fields={
              [{ key: "name", label: "Name", type: "text", required: true }, activeField] satisfies FieldConfig[]
            }
          />
        </div>
      )}
    </div>
  );
}
