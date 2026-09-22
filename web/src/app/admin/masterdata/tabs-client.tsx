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

const TABS = [
  { key: "asset", label: "Assets" },
  { key: "asset_type", label: "Asset Types" },
  { key: "location", label: "Locations" },
  { key: "organisation", label: "Organisation" },
  { key: "region", label: "Region" },
  { key: "grading", label: "Grading" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

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
      <p className="rounded-lg border border-black/[.08] px-4 py-6 text-center text-sm text-zinc-500 dark:border-white/[.145]">
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
    <div>
      <div className="mb-6 flex flex-wrap gap-1 border-b border-black/[.08] dark:border-white/[.145]">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? "border-b-2 border-zinc-950 text-zinc-950 dark:border-zinc-50 dark:text-zinc-50"
                : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
            }`}
          >
            {t.label}
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
              emptyLabel="No assets yet."
              onCreate={actions.createAsset}
              onUpdate={actions.updateAsset}
              onDelete={actions.deleteAsset}
              fields={
                [
                  { key: "legacy_uid", label: "#", type: "number", hideInForm: true },
                  { key: "name", label: "Name", type: "text", required: true },
                  { key: "code", label: "Code", type: "text", required: true },
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
                  { key: "has_service_plan", label: "Has service plan", type: "boolean" },
                  {
                    key: "service_interval",
                    label: "Service interval (yrs)",
                    type: "number",
                  },
                  { key: "active", label: "Active", type: "boolean", defaultValue: "true" },
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
              emptyLabel="No asset types yet."
              onCreate={actions.createAssetType}
              onUpdate={actions.updateAssetType}
              onDelete={actions.deleteAssetType}
              fields={
                [
                  { key: "legacy_uid", label: "#", type: "number", hideInForm: true },
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
                  { key: "active", label: "Active", type: "boolean", defaultValue: "true" },
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
              emptyLabel="No locations yet."
              onCreate={actions.createLocation}
              onUpdate={actions.updateLocation}
              onDelete={actions.deleteLocation}
              fields={
                [
                  { key: "legacy_uid", label: "#", type: "number", hideInForm: true },
                  { key: "name", label: "Name", type: "text", required: true },
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
                  },
                  { key: "is_stock_manager", label: "Stock manager", type: "boolean", defaultValue: "true" },
                  { key: "is_asset_manager", label: "Asset manager", type: "boolean", defaultValue: "true" },
                  { key: "active", label: "Active", type: "boolean", defaultValue: "true" },
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
              emptyLabel="No organisations yet."
              onCreate={actions.createOrganisation}
              onUpdate={actions.updateOrganisation}
              onDelete={actions.deleteOrganisation}
              fields={
                [
                  { key: "legacy_uid", label: "#", type: "number", hideInForm: true },
                  { key: "name", label: "Name", type: "text", required: true },
                  { key: "is_supplier", label: "Supplier", type: "boolean" },
                  {
                    key: "is_service_supplier",
                    label: "Service supplier",
                    type: "boolean",
                  },
                  { key: "active", label: "Active", type: "boolean", defaultValue: "true" },
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
              emptyLabel="No regions yet."
              onCreate={actions.createRegion}
              onUpdate={actions.updateRegion}
              onDelete={actions.deleteRegion}
              fields={
                [
                  { key: "legacy_uid", label: "#", type: "number", hideInForm: true },
                  { key: "name", label: "Name", type: "text", required: true },
                  { key: "active", label: "Active", type: "boolean", defaultValue: "true" },
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
              <div>
                <h3 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                  Colours (used by Grading)
                </h3>
                <EntityCrudTable
                  rows={colourContainers}
                  getId={(r) => r.id as string}
                  {...perms}
                  emptyLabel="No colours yet — add one before creating a Grading."
                  onCreate={actions.createColourContainer}
                  onUpdate={async () => ({ error: "Not editable — delete and re-create." })}
                  onDelete={actions.deleteColourContainer}
                  fields={
                    [
                      { key: "name", label: "Name", type: "text", required: true },
                      { key: "hex_colour", label: "Hex colour", type: "text" },
                      { key: "class_name", label: "CSS class", type: "text" },
                    ] satisfies FieldConfig[]
                  }
                />
              </div>
            )}
          </Permissioned>

          <Permissioned roles={roles} entity="grading">
            {(perms) => (
              <div>
                <h3 className="mb-2 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                  Gradings
                </h3>
                <EntityCrudTable
                  rows={gradings}
                  getId={(r) => r.id as string}
                  {...perms}
                  emptyLabel="No gradings yet."
                  onCreate={actions.createGrading}
                  onUpdate={actions.updateGrading}
                  onDelete={actions.deleteGrading}
                  fields={
                    [
                      { key: "legacy_uid", label: "#", type: "number", hideInForm: true },
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
                      { key: "class_name", label: "CSS class (derived)", type: "text", hideInForm: true },
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
