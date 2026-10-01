"use client";

import { useEffect, useState, useTransition } from "react";
import { Modal } from "../modal";
import { Switch } from "../switch";
import { StatusBadge } from "../status-badge";
import { PlusIcon } from "../icons";
import {
  cellInputClass,
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
import type {
  Barcode,
  Item,
  PackType,
  SupplierItem,
} from "@/lib/stock/types";
import {
  createBarcode,
  createItem,
  createSupplierItem,
  deleteBarcode,
  deleteItem,
  deleteSupplierItem,
  getItem,
  listBarcodes,
  listItems,
  listSupplierItems,
  setDefaultSupplierItem,
  updateItem,
  updateSupplierItem,
} from "./actions";

type Ctx =
  | { mode: "add"; saveFirst: () => Promise<string | null> }
  | { mode: "edit"; id: string; readOnly: boolean };

export type ItemPerms = {
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  // Barcodes and supplier terms are admin-maintained; the `user` role reads them.
  canManageDetails: boolean;
};

type Option = { value: string; label: string };

// The Items grid on Product_NewEdit. Each item is one product in one pack type;
// "Add Item" saves a new product first, then opens the item popup.
export function ProductItems({
  ctx,
  productUomCode,
  packTypes,
  supplierOptions,
  perms,
}: {
  ctx: Ctx;
  productUomCode: string;
  packTypes: PackType[];
  supplierOptions: Option[];
  perms: ItemPerms;
}) {
  const productId = ctx.mode === "edit" ? ctx.id : null;
  const [rows, setRows] = useState<Item[] | null>(null);
  const [modal, setModal] = useState<{ productId: string; item: Item | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!productId) return;
    let cancelled = false;
    listItems(productId).then((r) => {
      if (!cancelled) setRows(r);
    });
    return () => {
      cancelled = true;
    };
  }, [productId]);

  function add() {
    setError(null);
    startTransition(async () => {
      const id = ctx.mode === "add" ? await ctx.saveFirst() : ctx.id;
      if (id) setModal({ productId: id, item: null });
    });
  }

  function remove(item: Item) {
    if (!productId) return;
    if (!confirm("Delete this item? Its barcodes and supplier terms go with it.")) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteItem(item.id);
      if (res.error) setError(res.error);
      setRows(await listItems(productId));
    });
  }

  async function reload(id: string) {
    setRows(await listItems(id));
  }

  return (
    <section className="mt-8 overflow-hidden rounded-card border border-border">
      <div className="flex min-h-[52px] items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div>
          <h3 className={sectionHeadingClass}>Items</h3>
          <p className="mt-0.5 text-[11px] text-muted">
            A product in a pack type. An active product needs at least one active item.
          </p>
        </div>
        {perms.canCreate && (
          <button disabled={isPending} onClick={add} className={smallPrimaryButtonClass}>
            <PlusIcon className="h-3.5 w-3.5" />
            Add Item
          </button>
        )}
      </div>

      {error && (
        <p className="mx-4 mt-3 border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">
          {error}
        </p>
      )}

      {ctx.mode === "add" ? (
        <p className="px-4 py-6 text-center text-[13px] text-muted">
          No items yet.{perms.canCreate && " Adding one saves this product first."}
        </p>
      ) : rows === null ? (
        <p className="px-4 py-6 text-center text-[13px] text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-[13px] text-muted">No items yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-table-head">
              <th className={tableHeadCellClass}>Code</th>
              <th className={tableHeadCellClass}>Name</th>
              <th className={tableHeadCellClass}>Conversion</th>
              <th className={tableHeadCellClass}>Active</th>
              <th className={tableHeadCellClass} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="h-[44px] border-t border-border">
                <td className="px-3 font-mono text-[13px] text-muted">{r.code ?? "—"}</td>
                <td className="px-3 text-ink">{r.name}</td>
                <td className="px-3 text-ink">
                  {r.conversion_to_default_uom} {productUomCode}
                </td>
                <td className="px-3">
                  <StatusBadge active={r.active} />
                </td>
                <td className="px-3 text-right whitespace-nowrap">
                  <div className="flex justify-end gap-4">
                    <button
                      onClick={() => setModal({ productId: productId!, item: r })}
                      className={linkButtonClass}
                    >
                      {perms.canUpdate ? "Edit" : "View"}
                    </button>
                    {perms.canDelete && (
                      <button
                        disabled={isPending}
                        onClick={() => remove(r)}
                        className={dangerLinkButtonClass}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {modal && (
        <ItemModal
          key={modal.item?.id ?? "new"}
          productId={modal.productId}
          item={modal.item}
          productUomCode={productUomCode}
          packTypes={packTypes}
          supplierOptions={supplierOptions}
          perms={perms}
          onChanged={() => reload(modal.productId)}
          onClose={() => {
            setModal(null);
            reload(modal.productId);
          }}
        />
      )}
    </section>
  );
}

function ItemModal({
  productId,
  item: initial,
  productUomCode,
  packTypes,
  supplierOptions,
  perms,
  onChanged,
  onClose,
}: {
  productId: string;
  item: Item | null;
  productUomCode: string;
  packTypes: PackType[];
  supplierOptions: Option[];
  perms: ItemPerms;
  onChanged: () => void;
  onClose: () => void;
}) {
  // After the first save the popup stays open on the saved item, so barcodes
  // and supplier terms can be added straight away.
  const [item, setItem] = useState<Item | null>(initial);
  const [values, setValues] = useState({
    name: initial?.name ?? "",
    pack_type_id: initial?.pack_type_id ?? "",
    item_tracking_method: initial?.item_tracking_method ?? "FIFO",
    active: initial?.active ?? true,
  });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const readOnly = item ? !perms.canUpdate : !perms.canCreate;

  // The item's own pack type stays pickable even if it has since been deactivated.
  const packOptions = packTypes.filter((p) => p.active || p.id === item?.pack_type_id);

  function pickPack(id: string) {
    const pack = packTypes.find((p) => p.id === id);
    setValues((v) => ({
      ...v,
      pack_type_id: id,
      // A new item's name starts as its pack type's name.
      name: !item && !v.name.trim() && pack ? pack.name : v.name,
    }));
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const payload = { ...values, active: String(values.active) };
      let id = item?.id;
      if (id) {
        const res = await updateItem(id, payload);
        if (res.error) return setError(res.error);
      } else {
        const res = await createItem(productId, payload);
        if (res.error || !res.id) return setError(res.error ?? "Could not save.");
        id = res.id;
      }
      // Reload for the derived code and conversion factor.
      const fresh = await getItem(id);
      if (fresh) setItem(fresh);
      onChanged();
    });
  }

  return (
    <Modal
      open
      title={item ? (readOnly ? "View Item" : "Edit Item") : "New Item"}
      onClose={onClose}
      width={640}
      footer={
        <>
          <button disabled={isPending} onClick={onClose} className={secondaryButtonClass}>
            {readOnly ? "Close" : "Done"}
          </button>
          {!readOnly && (
            <button disabled={isPending} onClick={save} className={primaryButtonClass}>
              {isPending ? "Saving…" : "Save"}
            </button>
          )}
        </>
      }
    >
      {error && (
        <p className="mb-4 border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">{error}</p>
      )}

      <fieldset disabled={readOnly} className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className={labelClass}>Pack type</label>
          <select
            className={inputClass}
            value={values.pack_type_id}
            onChange={(e) => pickPack(e.target.value)}
          >
            <option value="">Select…</option>
            {packOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.code ?? "—"})
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={labelClass}>Name</label>
          <input
            className={inputClass}
            value={values.name}
            onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label className={labelClass}>Tracking method</label>
            <select
              className={inputClass}
              value={values.item_tracking_method}
              onChange={(e) =>
                setValues((v) => ({
                  ...v,
                  item_tracking_method: e.target.value as "FIFO" | "LIFO",
                }))
              }
            >
              <option value="FIFO">FIFO</option>
              <option value="LIFO">LIFO</option>
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className={labelClass}>Conversion to {productUomCode}</label>
            <input
              className={inputClass}
              disabled
              value={item ? `${item.conversion_to_default_uom} ${productUomCode}` : "Set on save"}
            />
          </div>
        </div>
        <Switch
          label="Active"
          checked={values.active}
          onChange={(v) => setValues((s) => ({ ...s, active: v }))}
        />
      </fieldset>

      {item ? (
        <>
          <SuppliersSection itemId={item.id} supplierOptions={supplierOptions} canEdit={perms.canManageDetails} />
          <BarcodesSection itemId={item.id} canEdit={perms.canManageDetails} />
        </>
      ) : (
        <p className="mt-6 text-[13px] text-muted">
          Save the item to add supplier terms and barcodes.
        </p>
      )}
    </Modal>
  );
}

function SuppliersSection({
  itemId,
  supplierOptions,
  canEdit,
}: {
  itemId: string;
  supplierOptions: Option[];
  canEdit: boolean;
}) {
  const [rows, setRows] = useState<SupplierItem[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState({ supplier_id: "", default_price_exc_vat: "", default_lead_time: "" });
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    listSupplierItems(itemId).then((r) => {
      if (!cancelled) setRows(r);
    });
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  const used = new Set((rows ?? []).map((r) => r.supplier_id));
  const pickable = supplierOptions.filter(
    (o) => !used.has(o.value) || (editing !== null && o.value === form.supplier_id),
  );

  function reset() {
    setEditing(null);
    setForm({ supplier_id: "", default_price_exc_vat: "", default_lead_time: "" });
  }

  function run(action: () => Promise<{ error: string | null }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res.error) setError(res.error);
      else after?.();
      setRows(await listSupplierItems(itemId));
    });
  }

  function save() {
    const payload = { ...form, is_default: String((rows ?? []).length === 0) };
    run(
      () => (editing ? updateSupplierItem(editing, payload) : createSupplierItem(itemId, payload)),
      reset,
    );
  }

  return (
    <section className="mt-6 overflow-hidden rounded-card border border-border">
      <div className="border-b border-border px-4 py-2.5">
        <h3 className={sectionHeadingClass}>Suppliers</h3>
        <p className="mt-0.5 text-[11px] text-muted">
          {canEdit ? "Changes here save immediately." : "Only admins can change supplier terms."}
        </p>
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <select
            aria-label="Supplier"
            className={`${cellInputClass} w-48`}
            value={form.supplier_id}
            onChange={(e) => setForm((f) => ({ ...f, supplier_id: e.target.value }))}
          >
            <option value="">Select supplier…</option>
            {pickable.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <input
            aria-label="Price excluding VAT"
            placeholder="Price (excl. VAT)"
            type="number"
            min="0"
            step="any"
            className={`${cellInputClass} w-36`}
            value={form.default_price_exc_vat}
            onChange={(e) => setForm((f) => ({ ...f, default_price_exc_vat: e.target.value }))}
          />
          <input
            aria-label="Lead time in days"
            placeholder="Lead time (days)"
            type="number"
            min="0"
            step="any"
            className={`${cellInputClass} w-36`}
            value={form.default_lead_time}
            onChange={(e) => setForm((f) => ({ ...f, default_lead_time: e.target.value }))}
          />
          <button
            disabled={isPending || !form.supplier_id}
            onClick={save}
            className={smallPrimaryButtonClass}
          >
            {!editing && <PlusIcon className="h-3.5 w-3.5" />}
            {editing ? "Update" : "Add"}
          </button>
          {editing && (
            <button onClick={reset} className={linkButtonClass}>
              Cancel
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="mx-4 mt-3 border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">{error}</p>
      )}

      {rows === null ? (
        <p className="px-4 py-5 text-center text-[13px] text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-5 text-center text-[13px] text-muted">No suppliers yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-table-head">
              <th className={tableHeadCellClass}>Supplier</th>
              <th className={tableHeadCellClass}>Price excl. VAT</th>
              <th className={tableHeadCellClass}>Lead time (days)</th>
              <th className={tableHeadCellClass}>Default</th>
              {canEdit && <th className={tableHeadCellClass} />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="h-[44px] border-t border-border">
                <td className="px-3 text-ink">{r.supplier?.name ?? "—"}</td>
                <td className="px-3 text-ink">{r.default_price_exc_vat}</td>
                <td className="px-3 text-ink">{r.default_lead_time}</td>
                <td className="px-3">
                  {r.is_default ? (
                    <span className="text-[13px] font-semibold text-primary">Default</span>
                  ) : (
                    canEdit && (
                      <button
                        disabled={isPending}
                        onClick={() => run(() => setDefaultSupplierItem(r.id))}
                        className={linkButtonClass}
                      >
                        Set as default
                      </button>
                    )
                  )}
                </td>
                {canEdit && (
                  <td className="px-3 text-right whitespace-nowrap">
                    <div className="flex justify-end gap-4">
                      <button
                        disabled={isPending}
                        onClick={() => {
                          setEditing(r.id);
                          setForm({
                            supplier_id: r.supplier_id,
                            default_price_exc_vat: String(r.default_price_exc_vat),
                            default_lead_time: String(r.default_lead_time),
                          });
                        }}
                        className={linkButtonClass}
                      >
                        Edit
                      </button>
                      <button
                        disabled={isPending}
                        onClick={() => run(() => deleteSupplierItem(r.id))}
                        className={dangerLinkButtonClass}
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function BarcodesSection({ itemId, canEdit }: { itemId: string; canEdit: boolean }) {
  const [rows, setRows] = useState<Barcode[] | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    listBarcodes(itemId).then((r) => {
      if (!cancelled) setRows(r);
    });
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  function run(action: () => Promise<{ error: string | null }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res.error) setError(res.error);
      else after?.();
      setRows(await listBarcodes(itemId));
    });
  }

  return (
    <section className="mt-6 overflow-hidden rounded-card border border-border">
      <div className="flex min-h-[52px] items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div>
          <h3 className={sectionHeadingClass}>Barcodes</h3>
          <p className="mt-0.5 text-[11px] text-muted">
            {canEdit ? "Changes here save immediately." : "Only admins can change barcodes."}
          </p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <input
              aria-label="Barcode"
              placeholder="Barcode"
              className={`${cellInputClass} w-44`}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && value.trim()) {
                  e.preventDefault();
                  run(() => createBarcode(itemId, value), () => setValue(""));
                }
              }}
            />
            <button
              disabled={isPending || !value.trim()}
              onClick={() => run(() => createBarcode(itemId, value), () => setValue(""))}
              className={smallPrimaryButtonClass}
            >
              <PlusIcon className="h-3.5 w-3.5" />
              Add
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="mx-4 mt-3 border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">{error}</p>
      )}

      {rows === null ? (
        <p className="px-4 py-5 text-center text-[13px] text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-5 text-center text-[13px] text-muted">No barcodes yet.</p>
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={r.id} className="flex h-[44px] items-center justify-between border-t border-border px-3">
              <span className="font-mono text-[13px] text-ink">{r.barcode}</span>
              {canEdit && (
                <button
                  disabled={isPending}
                  onClick={() => run(() => deleteBarcode(r.id))}
                  className={dangerLinkButtonClass}
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
