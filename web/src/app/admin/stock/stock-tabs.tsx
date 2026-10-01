"use client";

import { useState } from "react";
import { EntityCrudTable, type FieldConfig } from "../masterdata/entity-crud-table";
import { canStock, type StockEntity } from "@/lib/stock/permissions";
import type { MasterdataRole } from "@/lib/auth";
import type { Location, Organisation } from "@/lib/masterdata/types";
import {
  UOM_TYPES,
  type PackType,
  type Product,
  type ProductType,
  type StorageArea,
  type UnitOfMeasure,
} from "@/lib/stock/types";
import * as actions from "./actions";
import { ProductItems } from "./product-items";
import { UomConversions } from "./uom-conversions";

const TABS = [
  { key: "product", label: "Products" },
  { key: "pack_type", label: "Pack Types" },
  { key: "product_type", label: "Product Types" },
  { key: "storage_area", label: "Storage Areas" },
  { key: "unit_of_measure", label: "Units Of Measure" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function Permissioned({
  roles,
  entity,
  children,
}: {
  roles: MasterdataRole[];
  entity: StockEntity;
  children: (perms: {
    canCreate: boolean;
    canUpdate: boolean;
    canDelete: boolean;
    canView: boolean;
  }) => React.ReactNode;
}) {
  if (!canStock(roles, entity, "read")) {
    return (
      <p className="rounded-card border border-border bg-card px-4 py-8 text-center text-sm text-muted">
        You don&apos;t have permission to view this data.
      </p>
    );
  }
  return children({
    canCreate: canStock(roles, entity, "create"),
    canUpdate: canStock(roles, entity, "update"),
    canDelete: canStock(roles, entity, "delete"),
    canView: true,
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

export function StockTabs({
  roles,
  products,
  packTypes,
  productTypes,
  storageAreas,
  unitsOfMeasure,
  locations,
  organisations,
}: {
  roles: MasterdataRole[];
  products: Product[];
  packTypes: PackType[];
  productTypes: ProductType[];
  storageAreas: StorageArea[];
  unitsOfMeasure: UnitOfMeasure[];
  locations: Location[];
  organisations: Organisation[];
}) {
  const [tab, setTab] = useState<TabKey>("product");

  const counts: Record<TabKey, number> = {
    product: products.length,
    pack_type: packTypes.length,
    product_type: productTypes.length,
    storage_area: storageAreas.length,
    unit_of_measure: unitsOfMeasure.length,
  };

  const uomOptions = unitsOfMeasure
    .filter((u) => u.active)
    .map((u) => ({ value: u.id, label: `${u.code} — ${u.name}` }));
  const productTypeOptions = productTypes
    .filter((t) => t.active)
    .map((t) => ({ value: t.id, label: t.name }));
  // Storage areas belong to locations that keep stock.
  const locationOptions = locations
    .filter((l) => l.active && l.is_stock_manager)
    .map((l) => ({ value: l.id, label: l.name }));
  const supplierOptions = organisations
    .filter((o) => o.active && o.is_supplier)
    .map((o) => ({ value: o.id, label: o.name }));

  const itemPerms = {
    canCreate: canStock(roles, "item", "create"),
    canUpdate: canStock(roles, "item", "update"),
    canDelete: canStock(roles, "item", "delete"),
    canManageDetails:
      canStock(roles, "supplier_item", "update") && canStock(roles, "barcode", "update"),
  };

  return (
    <div className="px-4 pb-10 md:px-8">
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

      {tab === "product" && (
        <Permissioned roles={roles} entity="product">
          {(perms) => (
            <EntityCrudTable
              rows={products}
              getId={(r) => r.id as string}
              {...perms}
              itemLabel="Product"
              emptyLabel="No products yet."
              onCreate={actions.createProduct}
              onUpdate={actions.updateProduct}
              onDelete={actions.deleteProduct}
              renderDrawerExtra={(ctx) => (
                <ProductItems
                  ctx={ctx}
                  productUomCode={
                    ctx.mode === "edit"
                      ? (products.find((p) => p.id === ctx.id)?.uom?.code ?? "")
                      : ""
                  }
                  packTypes={packTypes}
                  supplierOptions={supplierOptions}
                  perms={itemPerms}
                />
              )}
              fields={
                [
                  legacyUidField,
                  { key: "code", label: "Code", type: "text", required: true, mono: true, section: "Details" },
                  { key: "name", label: "Name", type: "text", required: true },
                  {
                    key: "product_type_id",
                    label: "Product Type",
                    type: "select",
                    required: true,
                    options: productTypeOptions,
                    render: (_v, row) => (row.product_type as { name: string } | null)?.name ?? "—",
                  },
                  {
                    key: "uom_id",
                    label: "Unit Of Measure",
                    type: "select",
                    required: true,
                    options: uomOptions,
                    render: (_v, row) => (row.uom as { code: string } | null)?.code ?? "—",
                  },
                  { ...activeField, section: "Status" },
                ] satisfies FieldConfig[]
              }
            />
          )}
        </Permissioned>
      )}

      {tab === "pack_type" && (
        <Permissioned roles={roles} entity="pack_type">
          {(perms) => (
            <EntityCrudTable
              rows={packTypes}
              getId={(r) => r.id as string}
              {...perms}
              itemLabel="Pack Type"
              emptyLabel="No pack types yet."
              onCreate={actions.createPackType}
              onUpdate={actions.updatePackType}
              onDelete={actions.deletePackType}
              fields={
                [
                  legacyUidField,
                  { key: "name", label: "Name", type: "text", required: true },
                  { key: "qty", label: "Qty", type: "number", required: true },
                  {
                    key: "uom_id",
                    label: "Unit Of Measure",
                    type: "select",
                    required: true,
                    options: uomOptions,
                    render: (_v, row) => (row.uom as { code: string } | null)?.code ?? "—",
                  },
                  { key: "code", label: "Code (derived)", type: "text", hideInForm: true, mono: true },
                  activeField,
                ] satisfies FieldConfig[]
              }
            />
          )}
        </Permissioned>
      )}

      {tab === "product_type" && (
        <Permissioned roles={roles} entity="product_type">
          {(perms) => (
            <EntityCrudTable
              rows={productTypes}
              getId={(r) => r.id as string}
              {...perms}
              itemLabel="Product Type"
              emptyLabel="No product types yet."
              onCreate={actions.createProductType}
              onUpdate={actions.updateProductType}
              onDelete={actions.deleteProductType}
              fields={
                [
                  legacyUidField,
                  { key: "code", label: "Code", type: "text", required: true, mono: true },
                  { key: "name", label: "Name", type: "text", required: true },
                  activeField,
                ] satisfies FieldConfig[]
              }
            />
          )}
        </Permissioned>
      )}

      {tab === "storage_area" && (
        <Permissioned roles={roles} entity="storage_area">
          {(perms) => (
            <EntityCrudTable
              rows={storageAreas}
              getId={(r) => r.id as string}
              {...perms}
              itemLabel="Storage Area"
              emptyLabel="No storage areas yet."
              onCreate={actions.createStorageArea}
              onUpdate={actions.updateStorageArea}
              onDelete={actions.deleteStorageArea}
              fields={
                [
                  legacyUidField,
                  { key: "code", label: "Code", type: "text", required: true, mono: true },
                  { key: "name", label: "Name", type: "text", required: true },
                  {
                    key: "location_id",
                    label: "Location",
                    type: "select",
                    required: true,
                    options: locationOptions,
                    render: (_v, row) => (row.location as { name: string } | null)?.name ?? "—",
                  },
                  activeField,
                ] satisfies FieldConfig[]
              }
            />
          )}
        </Permissioned>
      )}

      {tab === "unit_of_measure" && (
        <Permissioned roles={roles} entity="unit_of_measure">
          {(perms) => (
            <EntityCrudTable
              rows={unitsOfMeasure}
              getId={(r) => r.id as string}
              {...perms}
              itemLabel="Unit Of Measure"
              emptyLabel="No units of measure yet."
              onCreate={actions.createUnitOfMeasure}
              onUpdate={actions.updateUnitOfMeasure}
              onDelete={actions.deleteUnitOfMeasure}
              renderDrawerExtra={(ctx) => (
                <UomConversions
                  ctx={ctx}
                  units={unitsOfMeasure}
                  canEdit={canStock(roles, "unit_of_measure_conversion", "create")}
                />
              )}
              fields={
                [
                  legacyUidField,
                  { key: "code", label: "Code", type: "text", required: true, mono: true },
                  { key: "name", label: "Name", type: "text", required: true },
                  {
                    key: "uom_type",
                    label: "Type",
                    type: "select",
                    required: true,
                    options: UOM_TYPES.map((t) => ({ value: t, label: t })),
                  },
                  activeField,
                ] satisfies FieldConfig[]
              }
            />
          )}
        </Permissioned>
      )}
    </div>
  );
}
