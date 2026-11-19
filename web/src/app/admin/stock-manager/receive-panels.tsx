"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { formatDateTime } from "@/lib/incidents/format";
import { docNumber, fieldOptions, type Options } from "@/lib/stock-manager/docs";
import { uploadStockDocument, type UploadedFile } from "@/lib/stock-manager/file-upload";
import type { DocRow, Receipt } from "@/lib/stock-manager/types";
import { PaperclipIcon, XIcon } from "../icons";
import {
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  sectionHeadingClass,
  tableHeadCellClass,
} from "../ui";
import { receivePurchaseOrder } from "./actions";
import { formatQty } from "./format";

// MWTS spec R1: receive a purchase order from its page. One step makes the
// load (today, driver = you unless typed), the PO intake and its lines; each
// line starts at what is still outstanding. Delivery note, invoice number
// and vehicle are optional (R2) and can be added to the intake later.
export function ReceivePanel({
  purchaseOrder,
  lines,
  options,
  defaultDriver,
}: {
  purchaseOrder: DocRow;
  lines: DocRow[];
  options: Options;
  defaultDriver: string;
}) {
  const router = useRouter();
  const open = lines.filter((l) => l.status === "new" && Number(l.qty_outstanding) > 0);
  const [expanded, setExpanded] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(open.map((l) => [l.id, String(Number(l.qty_outstanding))])),
  );
  const [area, setArea] = useState<string>(purchaseOrder.deliver_to_area_id ?? "");
  const [fields, setFields] = useState({ driver: defaultDriver, vehicle_reg_nr: "", delivery_note: "", invoice_number: "" });
  const [files, setFiles] = useState<File[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<{ error: boolean; text: string; href?: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  if (open.length === 0) return null;

  const areaOptions = fieldOptions({ key: "area", label: "", type: "select", options: "storageAreas" }, { area }, options);
  const itemLabel = (id: string) => options.items.find((o) => o.value === id)?.label ?? "—";

  function receive() {
    setMessage(null);
    startTransition(async () => {
      let uploaded: UploadedFile[] = [];
      try {
        uploaded = await Promise.all(files.map((f) => uploadStockDocument(f)));
      } catch (e) {
        setMessage({ error: true, text: e instanceof Error ? e.message : "Upload failed." });
        return;
      }
      const res = await receivePurchaseOrder({
        purchase_order_id: purchaseOrder.id,
        storage_area_id: area,
        ...fields,
        lines: open.map((l) => ({ purchase_order_item_id: l.id, qty: qty[l.id] ?? "" })),
        documents: uploaded,
      });
      if (res.error) {
        setMessage({ error: true, text: res.error });
        return;
      }
      setFiles([]);
      setExpanded(false);
      setMessage({
        error: false,
        text: `Received as ${docNumber("intakes", res.intakeReference!)} on load ${docNumber("loads", res.loadReference!)}.`,
        href: `/admin/stock-manager/intakes/${res.intakeReference}`,
      });
      router.refresh();
    });
  }

  return (
    <section className="rounded-card border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <h2 className={sectionHeadingClass}>Receive</h2>
          <p className="mt-1 text-xs text-muted">
            {open.length} line{open.length === 1 ? "" : "s"} still to receive. Each starts at what is outstanding; lower it for a
            short delivery or set it to 0.
          </p>
        </div>
        {!expanded && (
          <button type="button" className={primaryButtonClass} onClick={() => setExpanded(true)}>
            Receive
          </button>
        )}
      </div>

      {message && (
        <p className={`px-5 pb-3 text-sm ${message.error ? "text-danger" : "text-success"}`} role={message.error ? "alert" : "status"}>
          {message.text}{" "}
          {message.href && (
            <Link href={message.href} className="font-semibold text-primary hover:text-primary-hover">
              Open the intake
            </Link>
          )}
        </p>
      )}

      {expanded && (
        <div className="border-t border-border px-5 py-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className={labelClass}>
                Receive into<span className="text-danger"> *</span>
              </span>
              <select className={inputClass} value={area} disabled={isPending} onChange={(e) => setArea(e.target.value)}>
                <option value="">Select…</option>
                {areaOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={labelClass}>Driver</span>
              <input
                className={inputClass}
                value={fields.driver}
                disabled={isPending}
                onChange={(e) => setFields((f) => ({ ...f, driver: e.target.value }))}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={labelClass}>Delivery note</span>
              <input
                className={inputClass}
                value={fields.delivery_note}
                disabled={isPending}
                onChange={(e) => setFields((f) => ({ ...f, delivery_note: e.target.value }))}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={labelClass}>Invoice number</span>
              <input
                className={inputClass}
                value={fields.invoice_number}
                disabled={isPending}
                onChange={(e) => setFields((f) => ({ ...f, invoice_number: e.target.value }))}
              />
              <span className="text-xs text-muted">Can be added to the intake later.</span>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className={labelClass}>Vehicle reg nr</span>
              <input
                className={inputClass}
                value={fields.vehicle_reg_nr}
                disabled={isPending}
                onChange={(e) => setFields((f) => ({ ...f, vehicle_reg_nr: e.target.value }))}
              />
            </label>
            <div className="flex flex-col gap-1.5">
              <span className={labelClass}>Delivery note photo or file</span>
              <input
                ref={fileInput}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => {
                  setFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])]);
                  if (fileInput.current) fileInput.current.value = "";
                }}
              />
              <button
                type="button"
                className={`${secondaryButtonClass} self-start`}
                disabled={isPending}
                onClick={() => fileInput.current?.click()}
              >
                <PaperclipIcon className="h-4 w-4" />
                Attach
              </button>
              {files.map((f, i) => (
                <span key={`${f.name}-${i}`} className="flex items-center gap-2 text-sm text-ink">
                  {f.name}
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    disabled={isPending}
                    onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <XIcon className="h-4 w-4 text-muted" />
                  </button>
                </span>
              ))}
            </div>
          </div>

          <table className="mt-5 w-full text-sm">
            <thead>
              <tr>
                <th className={tableHeadCellClass}>Item</th>
                <th className={`${tableHeadCellClass} text-right`}>Ordered</th>
                <th className={`${tableHeadCellClass} text-right`}>Received</th>
                <th className={`${tableHeadCellClass} text-right`}>Outstanding</th>
                <th className={`${tableHeadCellClass} w-36 text-right`}>Receive now</th>
              </tr>
            </thead>
            <tbody>
              {open.map((l) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="py-2 pr-3 font-medium text-ink">{itemLabel(l.item_id)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatQty(l.qty_ordered)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatQty(l.qty_received)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{formatQty(l.qty_outstanding)}</td>
                  <td className="py-2 text-right">
                    <input
                      aria-label={`Receive now: ${itemLabel(l.item_id)}`}
                      className={`${inputClass} w-28 text-right`}
                      inputMode="decimal"
                      value={qty[l.id] ?? ""}
                      disabled={isPending}
                      onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button type="button" className={primaryButtonClass} disabled={isPending} onClick={receive}>
              {isPending ? "Receiving…" : "Receive stock"}
            </button>
            <button type="button" className={secondaryButtonClass} disabled={isPending} onClick={() => setExpanded(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// MWTS spec R1: the intakes made against this purchase order.
export function ReceiptsPanel({ receipts, options, timeZone }: { receipts: Receipt[]; options: Options; timeZone: string }) {
  return (
    <section className="rounded-card border border-border bg-card">
      <div className="px-5 py-4">
        <h2 className={sectionHeadingClass}>Receipts</h2>
      </div>
      {receipts.length === 0 ? (
        <p className="border-t border-border px-5 py-6 text-center text-sm text-muted">Nothing received yet.</p>
      ) : (
        <ul className="border-t border-border">
          {receipts.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-5 py-2.5 text-sm last:border-b-0">
              <Link href={`/admin/stock-manager/intakes/${r.reference}`} className="font-semibold text-primary hover:text-primary-hover">
                {docNumber("intakes", r.reference)}
              </Link>
              <span className="tabular-nums text-muted">{formatDateTime(r.intake_date, timeZone)}</span>
              <span className="text-muted">{options.storageAreas.find((o) => o.value === r.storage_area_id)?.label ?? "—"}</span>
              {r.driver && <span className="text-muted">by {r.driver}</span>}
              <span className="text-muted">Delivery note {r.delivery_note ?? "—"}</span>
              <span className="text-muted">Invoice {r.invoice_number ?? "—"}</span>
              <span className="ml-auto font-semibold tabular-nums text-ink">Qty {formatQty(r.qty)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
