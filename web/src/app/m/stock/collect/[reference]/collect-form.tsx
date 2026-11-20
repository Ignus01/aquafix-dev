"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { docNumber, type Option } from "@/lib/stock-manager/docs";
import { uploadStockDocument, type UploadedFile } from "@/lib/stock-manager/file-upload";
import type { CollectableOrder } from "@/lib/stock-manager/types";
import { receivePurchaseOrder } from "../../../../admin/stock-manager/actions";
import { CameraIcon, XIcon } from "../../../icons";
import { FormFooter, mBtnGreen, mBtnLight, mInput, mLabel } from "../../../ui";

const plain = (n: number) => String(Number(n));

// MWTS spec R3: one tap — Collected — makes the load (today, driver = me) and
// the PO intake into the order's Deliver to. Each line starts at what is
// still outstanding; lower it for a short delivery. A photo of the delivery
// note is optional. With no Deliver to on the order, it goes into my kit.
export function CollectForm({
  order,
  items,
  areas,
  myKit,
}: {
  order: CollectableOrder;
  items: Option[];
  areas: Option[];
  myKit: string | null;
}) {
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(order.lines.map((l) => [l.id, plain(Math.max(Number(l.qty_outstanding), 0))])),
  );
  const [area, setArea] = useState(order.deliver_to_area_id ?? myKit ?? "");
  // Optional per line: the batch number and expiry printed on the pack.
  const [batch, setBatch] = useState<Record<string, { batch_number: string; expiry_date: string }>>({});
  const batchOf = (id: string) => batch[id] ?? { batch_number: "", expiry_date: "" };
  const [deliveryNote, setDeliveryNote] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const camera = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const itemName = (id: string) => items.find((o) => o.value === id)?.label ?? "—";

  function collected() {
    setError(null);
    if (!area) {
      setError("Choose where the stock goes.");
      return;
    }
    startTransition(async () => {
      let uploaded: UploadedFile[] = [];
      try {
        uploaded = await Promise.all(photos.map((p) => uploadStockDocument(p)));
      } catch (e) {
        setError(e instanceof Error ? e.message : "The photo didn't upload.");
        return;
      }
      const res = await receivePurchaseOrder({
        purchase_order_id: order.id,
        storage_area_id: area,
        delivery_note: deliveryNote,
        lines: order.lines.map((l) => ({ purchase_order_item_id: l.id, qty: qty[l.id] ?? "", ...batchOf(l.id) })),
        documents: uploaded,
      });
      if (res.error) {
        setError(res.error);
        return;
      }
      router.push(
        `/m/stock/collect?saved=${encodeURIComponent(`${docNumber("purchase-orders", order.reference)} collected`)}`,
      );
      router.refresh();
    });
  }

  return (
    <div className="flex-1 px-4 pt-3 pb-[96px]">
      {error && <p className="mb-3 rounded-[8px] bg-[#fdedec] px-3 py-2 text-[16px] text-[#b42318]">{error}</p>}

      <dl className="mb-4 grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-[18px]">
        <dt className="font-semibold">Supplier</dt>
        <dd>{order.supplier_name}</dd>
        {order.order_alias && (
          <>
            <dt className="font-semibold">Alias</dt>
            <dd>{order.order_alias}</dd>
          </>
        )}
        {order.collect_from === "STORAGE_AREA" && (
          <>
            <dt className="font-semibold">Collect at</dt>
            <dd>{areas.find((a) => a.value === order.collect_from_area_id)?.label ?? "—"}</dd>
          </>
        )}
        {order.comment && (
          <>
            <dt className="font-semibold">Note</dt>
            <dd className="whitespace-pre-line">{order.comment}</dd>
          </>
        )}
      </dl>

      <ul className="mb-4 overflow-hidden rounded-[8px] border border-[#dfe2e8] bg-white">
        {order.lines.map((l) => (
          <li key={l.id} className="border-b border-[#dfe2e8] px-3 py-3 last:border-b-0">
            <div className="text-[19px] font-semibold">{itemName(l.item_id)}</div>
            <div className="mt-1 flex items-center justify-between gap-3">
              <span className="text-[16px] text-[#5b6480]">
                Outstanding {plain(l.qty_outstanding)} of {plain(l.qty_ordered)}
              </span>
              <input
                aria-label={`Collected: ${itemName(l.item_id)}`}
                className={`${mInput} !w-28 text-right`}
                inputMode="decimal"
                value={qty[l.id] ?? ""}
                disabled={isPending}
                onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value.replace(",", ".") }))}
              />
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input
                aria-label={`Batch: ${itemName(l.item_id)}`}
                placeholder="Batch (optional)"
                className={`${mInput} !text-[16px]`}
                value={batchOf(l.id).batch_number}
                disabled={isPending}
                onChange={(e) => setBatch((b) => ({ ...b, [l.id]: { ...batchOf(l.id), batch_number: e.target.value } }))}
              />
              <input
                aria-label={`Expiry: ${itemName(l.item_id)}`}
                type="date"
                className={`${mInput} !text-[16px]`}
                value={batchOf(l.id).expiry_date}
                disabled={isPending}
                onChange={(e) => setBatch((b) => ({ ...b, [l.id]: { ...batchOf(l.id), expiry_date: e.target.value } }))}
              />
            </div>
          </li>
        ))}
      </ul>

      <label htmlFor="area" className={mLabel}>
        Goes into
      </label>
      <select id="area" className={mInput} value={area} disabled={isPending} onChange={(e) => setArea(e.target.value)}>
        <option value="">Select…</option>
        {areas.map((a) => (
          <option key={a.value} value={a.value}>
            {a.value === myKit ? `My kit — ${a.label}` : a.label}
          </option>
        ))}
      </select>

      <label htmlFor="dn" className={`${mLabel} mt-4`}>
        Delivery note (optional)
      </label>
      <input id="dn" className={mInput} value={deliveryNote} disabled={isPending} onChange={(e) => setDeliveryNote(e.target.value)} />

      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          setPhotos((prev) => [...prev, ...Array.from(e.target.files ?? [])]);
          if (camera.current) camera.current.value = "";
        }}
      />
      <button
        type="button"
        className={`${mBtnLight} mt-4 flex items-center gap-2`}
        disabled={isPending}
        onClick={() => camera.current?.click()}
      >
        <CameraIcon className="h-5 w-5" />
        Photo of delivery note
      </button>
      {photos.map((p, i) => (
        <div key={`${p.name}-${i}`} className="mt-2 flex items-center justify-between text-[17px]">
          <span className="truncate">{p.name}</span>
          <button type="button" aria-label="Remove photo" disabled={isPending} onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}>
            <XIcon className="h-5 w-5" />
          </button>
        </div>
      ))}

      <FormFooter>
        <button type="button" className={mBtnLight} disabled={isPending} onClick={() => router.push("/m/stock/collect")}>
          Cancel
        </button>
        <button type="button" className={mBtnGreen} disabled={isPending} onClick={collected}>
          {isPending ? "Saving…" : "Collected"}
        </button>
      </FormFooter>
    </div>
  );
}
