"use client";

import { useState } from "react";
import { EntityCrudTable, type FieldConfig } from "./entity-crud-table";
import { can, type MasterdataEntity } from "@/lib/masterdata/permissions";
import type { MasterdataRole } from "@/lib/auth";
import type {
  Region,
  Organisation,
  AssetType,
  Location,
  ColourContainer,
  Grading,
  Asset,
} from "@/lib/masterdata/types";
import * as actions from "./actions";

function makeTabs(counts: Record<string, number>) {
  return [
    { key: "asset", label: "Assets", count: counts.asset },
    { key: "asset_type", label: "Asset Types", count: counts.asset_type },
    { key: "location", label: "Locations", count: counts.location },
    { key: "organisation", label: "Organisation", count: counts.organisation },
    { key: "region", label: "Region", count: counts.region },
    { key: "grading", label: "Grading", count: counts.grading },
  ] as const;
}

type TabKey = ReturnType<typeof makeTabs>[number]["key"];

function Permissioned({
  roles,
  entity,
  children,
}: {
  roles: MasterdataRole[];
  entity: MasterdataEntity;
  children: (perms: { canCreate: boolean; canUpdate: boolean; canDelete: boolean }) => React.ReactNode;
}) {
  if (!can(roles, entity, "read")) {
    return (
      <p className="rounded-card border border-border bg-card px-4 py-8 text-center text-sm text-muted">
        You don&apos;t have permission to view this data.
      </p>
    );
  }
  return children({
    canCreate: can(roles, entity, "create"),
    canUpdate: can(roles, entity, "update"),
    canDelete: can(roles, entity, "delete"),
  });
}

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

export function MasterdataTabs({
  roles,
  regions,
  organisations,
  assetTypes,
  locations,
  colourContainers,
  gradings,
  assets,
}: {
  roles: MasterdataRole[];
  regions: Region[];
  organisations: Organisation[];
  assetTypes: AssetType[];
  locations: Location[];
  colourContainers: ColourContainer[];
  gradings: Grading[];
  assets: Asset[];
}) {
  const [tab, setTab] = useState<TabKey>("asset");

  const tabs = makeTabs({
    asset: assets.length,
    asset_type: assetTypes.length,
    location: locations.length,
    organisation: organisations.length,
    region: regions.length,
    grading: gradings.length,
  });

  const regionOptions = regions
    .filter((r) => r.active)
    .map((r) => ({ value: r.id, label: r.name }));
  const organisationOptions = organisations
    .filter((o) => o.active)
    .map((o) => ({ value: o.id, label: o.name }));
  const assetTypeOptionsForAsset = assetTypes
    .filter((t) => t.active && t.classification === "OTHER")
    .map((t) => ({ value: t.id, label: t.name }));
  const locationOptionsForAsset = locations
    .filter((l) => l.active && l.is_asset_manager)
    .map((l) => ({ value: l.id, label: l.name }));
  const colourContainerOptions = colourContainers.map((c) => ({
    value: c.id,
    label: c.name,
  }));

  return (
    <div className="px-8 pb-10">
      <div className="mb-6 flex flex-wrap gap-1 border-b border-border">
        {tabs.map((t) => (
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
                tab === t.key
                  ? "bg-primary/10 text-primary"
                  : "bg-black/[.04] text-muted"
              }`}
            >
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {tab === "asset" && (
        <Permissioned roles={roles} entity="asset">
          {(perms) => (
            <EntityCrudTable
              rows={assets}
              getId={(r) => r.id as string}
              {...perms}
              itemLabel="Asset"
              emptyLabel="No assets yet."
              onCreate={actions.createAsset}
              onUpdate={actions.updateAsset}
              onDelete={actions.deleteAsset}
              fields={
                [
                  legacyUidField,
                  { key: "name", label: "Name", type: "text", required: true, section: "Details" },
                  { key: "code", label: "Code", type: "text", required: true, mono: true },
                  {
                    key: "asset_type_id",
                    label: "Asset Type",
                    type: "select",
                    required: true,
                    options: assetTypeOptionsForAsset,
                    render: (_v, row) =>
                      (row.asset_type as { name: string } | null)?.name ?? "—",
                  },
                  {
                    key: "location_id",
                    label: "Location",
                    type: "select",
                    required: true,
                    options: locationOptionsForAsset,
                    render: (_v, row) =>
                      (row.location as { name: string } | null)?.name ?? "—",
                  },
                  { key: "purchase_date", label: "Purchase date", type: "date" },
                  {
                    key: "has_service_plan",
                    label: "Has service plan",
                    type: "boolean",
                    section: "Service plan",
                  },
                  {
                    key: "service_interval",
                    label: "Service interval (yrs)",
                    type: "number",
                  },
                  { ...activeField, section: "Status" },
                ] satisfies FieldConfig[]
              }
            />
          )}
        </Permissioned>
      )}

      {tab === "asset_type" && (
        <Permissioned roles={roles} entity="asset_type">
          {(perms) => (
            <EntityCrudTable
              rows={assetTypes}
              getId={(r) => r.id as string}
              {...perms}
              itemLabel="Asset Type"
              emptyLabel="No asset types yet."
              onCreate={actions.createAssetType}
              onUpdate={actions.updateAssetType}
              onDelete={actions.deleteAssetType}
              fields={
                [
                  legacyUidField,
                  { key: "name", label: "Name", type: "text", required: true },
                  {
                    key: "classification",
                    label: "Classification",
                    type: "select",
                    required: true,
                    defaultValue: "OTHER",
                    options: [
                      { value: "FLEET", label: "FLEET" },
                      { value: "OTHER", label: "OTHER" },
                    ],
                  },
                  activeField,
                ] satisfies FieldConfig[]
              }
            />
          )}
        </Permissioned>
      )}

      {tab === "location" && (
        <Permissioned roles={roles} entity="location">
          {(perms) => (
            <EntityCrudTable
              rows={locations}
              getId={(r) => r.id as string}
              {...perms}
              itemLabel="Location"
              emptyLabel="No locations yet."
              onCreate={actions.createLocation}
              onUpdate={actions.updateLocation}
              onDelete={actions.deleteLocation}
              fields={
                [
                  legacyUidField,
                  { key: "name", label: "Name", type: "text", required: true, section: "Details" },
                  {
                    key: "region_id",
                    label: "Region",
                    type: "select",
                    required: true,
                    options: regionOptions,
                    render: (_v, row) =>
                      (row.region as { name: string } | null)?.name ?? "—",
                  },
                  {
                    key: "organisation_id",
                    label: "Organisation",
                    type: "select",
                    required: true,
                    options: organisationOptions,
                    render: (_v, row) =>
                      (row.organisation as { name: string } | null)?.name ?? "—",
                  },
                  {
                    key: "transfer_type",
                    label: "Transfer type",
                    type: "select",
                    defaultValue: "AUTO",
                    options: [
                      { value: "AUTO", label: "AUTO" },
                      { value: "MANUAL", label: "MANUAL" },
                    ],
                    section: "Capabilities",
                  },
                  { key: "is_stock_manager", label: "Stock manager", type: "boolean", defaultValue: "true" },
                  { key: "is_asset_manager", label: "Asset manager", type: "boolean", defaultValue: "true" },
                  { ...activeField, section: "Status" },
                ] satisfies FieldConfig[]
              }
            />
          )}
        </Permissioned>
      )}

      {tab === "organisation" && (
        <Permissioned roles={roles} entity="organisation">
          {(perms) => (
            <EntityCrudTable
              rows={organisations}
              getId={(r) => r.id as string}
              {...perms}
              itemLabel="Organisation"
              emptyLabel="No organisations yet."
              onCreate={actions.createOrganisation}
              onUpdate={actions.updateOrganisation}
              onDelete={actions.deleteOrganisation}
              fields={
                [
                  legacyUidField,
                  { key: "name", label: "Name", type: "text", required: true, section: "Details" },
                  { key: "is_supplier", label: "Supplier", type: "boolean", section: "Roles" },
                  {
                    key: "is_service_supplier",
                    label: "Service supplier",
                    type: "boolean",
                  },
                  { ...activeField, section: "Status" },
                ] satisfies FieldConfig[]
              }
            />
          )}
        </Permissioned>
      )}

      {tab === "region" && (
        <Permissioned roles={roles} entity="region">
          {(perms) => (
            <EntityCrudTable
              rows={regions}
              getId={(r) => r.id as string}
              {...perms}
              itemLabel="Region"
              emptyLabel="No regions yet."
              onCreate={actions.createRegion}
              onUpdate={actions.updateRegion}
              onDelete={actions.deleteRegion}
              fields={
                [
                  legacyUidField,
                  { key: "name", label: "Name", type: "text", required: true },
                  activeField,
                ] satisfies FieldConfig[]
              }
            />
          )}
        </Permissioned>
      )}

      {tab === "grading" && (
        <div className="flex flex-col gap-8">
          <Permissioned roles={roles} entity="colour_container">
            {(perms) => (
              <div className="rounded-card border border-border bg-card p-5">
                <h3 className="mb-4 text-[11px] font-semibold tracking-wider text-muted uppercase">
                  Colours (used by Grading)
                </h3>
                <EntityCrudTable
                  rows={colourContainers}
                  getId={(r) => r.id as string}
                  {...perms}
                  itemLabel="Colour"
                  emptyLabel="No colours yet — add one before creating a Grading."
                  onCreate={actions.createColourContainer}
                  onUpdate={async () => ({ error: "Not editable — delete and re-create." })}
                  onDelete={actions.deleteColourContainer}
                  fields={
                    [
                      { key: "name", label: "Name", type: "text", required: true },
                      { key: "hex_colour", label: "Hex colour", type: "text" },
                      { key: "class_name", label: "CSS class", type: "text", mono: true },
                    ] satisfies FieldConfig[]
                  }
                />
              </div>
            )}
          </Permissioned>

          <Permissioned roles={roles} entity="grading">
            {(perms) => (
              <div className="rounded-card border border-border bg-card p-5">
                <h3 className="mb-4 text-[11px] font-semibold tracking-wider text-muted uppercase">
                  Gradings
                </h3>
                <EntityCrudTable
                  rows={gradings}
                  getId={(r) => r.id as string}
                  {...perms}
                  itemLabel="Grading"
                  emptyLabel="No gradings yet."
                  onCreate={actions.createGrading}
                  onUpdate={actions.updateGrading}
                  onDelete={actions.deleteGrading}
                  fields={
                    [
                      legacyUidField,
                      { key: "name", label: "Name", type: "text", required: true },
                      {
                        key: "priority",
                        label: "Priority",
                        type: "number",
                        editOnly: true,
                      },
                      {
                        key: "colour_container_id",
                        label: "Colour",
                        type: "select",
                        required: true,
                        options: colourContainerOptions,
                        render: (_v, row) =>
                          (row.colour_container as { name: string } | null)?.name ?? "—",
                      },
                      { key: "class_name", label: "CSS class (derived)", type: "text", hideInForm: true, mono: true },
                    ] satisfies FieldConfig[]
                  }
                />
              </div>
            )}
          </Permissioned>
        </div>
      )}
    </div>
  );
}
