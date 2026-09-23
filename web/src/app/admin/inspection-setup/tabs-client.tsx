"use client";

import { useState, useTransition } from "react";
import { EntityCrudTable, type FieldConfig } from "../masterdata/entity-crud-table";
import { Drawer } from "../drawer";
import { canInspectionSetup } from "@/lib/inspection-setup/permissions";
import type { MasterdataRole } from "@/lib/auth";
import type {
  Account,
  GradingOption,
  IncidentType,
  Inspection,
  InspectionDetail,
} from "@/lib/inspection-setup/types";
import * as actions from "./actions";
import { InspectionEditor } from "./inspection-editor";
import { SubscriptionsSection } from "./subscriptions-section";

const TABS = [
  { key: "inspection", label: "Inspections" },
  { key: "incident_type", label: "Incident Types" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const legacyUidField: FieldConfig = {
  key: "legacy_uid",
  label: "UID",
  type: "number",
  hideInForm: true,
  mono: true,
};

const activeField: FieldConfig = {
  key: "active",
  label: "Active",
  type: "boolean",
  defaultValue: "true",
  statusBadge: true,
};

function yesNo(v: string) {
  return v === "true" ? "Yes" : "No";
}

export function InspectionSetupTabs({
  roles,
  inspections,
  incidentTypes,
  gradings,
  assetTypes,
  accounts,
}: {
  roles: MasterdataRole[];
  inspections: Inspection[];
  incidentTypes: IncidentType[];
  gradings: GradingOption[];
  assetTypes: { id: string; name: string; active: boolean }[];
  accounts: Account[];
}) {
  const [tab, setTab] = useState<TabKey>("inspection");
  const counts: Record<TabKey, number> = {
    inspection: inspections.length,
    incident_type: incidentTypes.length,
  };

  // Inspection editor: null = closed, "loading" while fetching child rows.
  const [editor, setEditor] = useState<
    null | { state: "loading" } | { state: "ready"; detail: InspectionDetail | null }
  >(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const canEditInspections = canInspectionSetup(roles, "inspection", "update");

  function openInspection(row: Record<string, unknown>) {
    setLoadError(null);
    setEditor({ state: "loading" });
    startTransition(async () => {
      try {
        const detail = await actions.getInspectionDetail(row.id as string);
        if (!detail) {
          setEditor(null);
          setLoadError("That inspection no longer exists.");
        } else {
          setEditor({ state: "ready", detail });
        }
      } catch {
        setEditor(null);
        setLoadError("Could not load the inspection.");
      }
    });
  }

  return (
    <div className="px-8 pb-10">
      <div className="mb-6 flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
              tab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {t.label}
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${
                tab === t.key ? "bg-primary/10 text-primary" : "bg-black/[.04] text-muted"
              }`}
            >
              {counts[t.key]}
            </span>
          </button>
        ))}
      </div>

      {tab === "inspection" && (
        <>
          {loadError && (
            <p className="mb-4 border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">
              {loadError}
            </p>
          )}
          <EntityCrudTable
            rows={inspections}
            getId={(r) => r.id as string}
            canCreate={canInspectionSetup(roles, "inspection", "create")}
            canUpdate={canEditInspections}
            canDelete={canInspectionSetup(roles, "inspection", "delete")}
            itemLabel="Inspection"
            emptyLabel="No inspections yet."
            customEditor={{
              onAdd: () => setEditor({ state: "ready", detail: null }),
              onOpen: openInspection,
            }}
            onCreate={async () => ({ error: null })}
            onUpdate={async () => ({ error: null })}
            onDelete={actions.deleteInspection}
            fields={
              [
                legacyUidField,
                { key: "name", label: "Name", type: "text" },
                {
                  key: "description",
                  label: "Description",
                  type: "text",
                  render: (v) =>
                    v ? (
                      <span className="line-clamp-1 max-w-[320px] text-muted" title={v}>
                        {v}
                      </span>
                    ) : (
                      "—"
                    ),
                },
                {
                  key: "value_type",
                  label: "Value type",
                  type: "text",
                  render: (v) => (
                    <span className="rounded-full bg-black/[.04] px-2.5 py-0.5 font-mono text-[11px] font-medium text-ink">
                      {v}
                    </span>
                  ),
                },
                { key: "is_required", label: "Required", type: "boolean", render: yesNo },
                { key: "nr_of_images_required", label: "Images", type: "number" },
                activeField,
              ] satisfies FieldConfig[]
            }
          />
        </>
      )}

      {tab === "incident_type" && (
        <EntityCrudTable
          rows={incidentTypes}
          getId={(r) => r.id as string}
          canCreate={canInspectionSetup(roles, "incident_type", "create")}
          canUpdate={canInspectionSetup(roles, "incident_type", "update")}
          canDelete={canInspectionSetup(roles, "incident_type", "delete")}
          itemLabel="Incident Type"
          emptyLabel="No incident types yet."
          onCreate={actions.createIncidentType}
          onUpdate={actions.updateIncidentType}
          onDelete={actions.deleteIncidentType}
          renderDrawerExtra={(ctx) => (
            <SubscriptionsSection
              ctx={ctx}
              accounts={accounts}
              canEdit={canInspectionSetup(roles, "incident_subscription", "create")}
            />
          )}
          fields={
            [
              legacyUidField,
              { key: "name", label: "Name", type: "text", required: true },
              {
                key: "is_image_required",
                label: "Image required",
                type: "boolean",
                render: yesNo,
              },
              {
                key: "disables_location",
                label: "Disables location",
                type: "boolean",
                render: yesNo,
              },
              activeField,
            ] satisfies FieldConfig[]
          }
        />
      )}

      {editor?.state === "loading" && (
        <Drawer open width={1120} title="Inspection" onClose={() => setEditor(null)}>
          <p className="py-10 text-center text-sm text-muted">Loading…</p>
        </Drawer>
      )}
      {editor?.state === "ready" && (
        <InspectionEditor
          key={editor.detail?.inspection.id ?? "new"}
          detail={editor.detail}
          readOnly={
            editor.detail
              ? !canEditInspections
              : !canInspectionSetup(roles, "inspection", "create")
          }
          gradings={gradings}
          assetTypes={assetTypes}
          incidentTypes={incidentTypes}
          onClose={() => setEditor(null)}
        />
      )}
    </div>
  );
}
