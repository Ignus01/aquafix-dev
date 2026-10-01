"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { formatDateTime } from "@/lib/incidents/format";
import { docNumber, type Options } from "@/lib/stock-manager/docs";
import { uploadStockDocument } from "@/lib/stock-manager/file-upload";
import type { DocFile, DocRow } from "@/lib/stock-manager/types";
import { PaperclipIcon, PlusIcon } from "../icons";
import { dangerLinkButtonClass, linkButtonClass, sectionHeadingClass, smallPrimaryButtonClass } from "../ui";
import { addDocumentFile, deleteDocumentFile, getDocumentFileUrl, saveLine } from "./actions";
import { formatQty } from "./format";

// Delivery notes and invoices on a load or an intake (Document_NewEdit).
export function DocumentsPanel({
  parent,
  files,
  timeZone,
  canEdit,
}: {
  parent: { kind: "loads" | "intakes"; id: string };
  files: DocFile[];
  timeZone: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function upload(file: File | undefined) {
    if (!file) return;
    setError(null);
    startTransition(async () => {
      try {
        const uploaded = await uploadStockDocument(file);
        const res = await addDocumentFile(parent, uploaded);
        if (res.error) setError(res.error);
        else router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed.");
      } finally {
        if (input.current) input.current.value = "";
      }
    });
  }

  function download(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await getDocumentFileUrl(id);
      if (res.error || !res.url) setError(res.error ?? "Couldn't prepare the download.");
      else window.location.assign(res.url);
    });
  }

  function remove(file: DocFile) {
    if (!window.confirm(`Delete ${file.name}?`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteDocumentFile(file.id);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <section className="rounded-card border border-border bg-card">
      <div className="flex items-center justify-between px-5 py-4">
        <h2 className={sectionHeadingClass}>Documents</h2>
        {canEdit && (
          <>
            <input ref={input} type="file" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
            <button type="button" onClick={() => input.current?.click()} disabled={isPending} className={smallPrimaryButtonClass}>
              <PlusIcon className="h-3.5 w-3.5" />
              Upload document
            </button>
          </>
        )}
      </div>
      {error && (
        <p className="px-5 pb-3 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      {files.length === 0 ? (
        <p className="border-t border-border px-5 py-6 text-center text-sm text-muted">
          No documents. Attach delivery notes and invoices here.
        </p>
      ) : (
        <ul className="border-t border-border">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 border-b border-border px-5 py-2.5 text-sm last:border-b-0">
              <PaperclipIcon className="h-4 w-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1 truncate text-ink">{f.name}</span>
              <span className="text-xs text-muted">{(f.size_bytes / (1024 * 1024)).toFixed(2)} MB</span>
              <span className="hidden text-xs text-muted sm:inline">{formatDateTime(f.created_at, timeZone)}</span>
              <button type="button" onClick={() => download(f.id)} disabled={isPending} className={linkButtonClass}>
                Download
              </button>
              {canEdit && (
                <button type="button" onClick={() => remove(f)} disabled={isPending} className={dangerLinkButtonClass}>
                  Delete
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// A load groups intakes; new ones are started from here.
export function LoadIntakesPanel({
  loadReference,
  intakes,
  options,
  canCreate,
}: {
  loadReference: number;
  intakes: DocRow[];
  options: Options;
  canCreate: boolean;
}) {
  return (
    <section className="rounded-card border border-border bg-card">
      <div className="flex items-center justify-between px-5 py-4">
        <h2 className={sectionHeadingClass}>Intakes on this load</h2>
        {canCreate && (
          <Link
            href={`/admin/stock-manager/intakes/new?load=${loadReference}`}
            className="flex h-[32px] items-center gap-1.5 rounded-control bg-primary px-3 text-[13px] font-semibold text-white transition-colors hover:bg-primary-hover"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            New PO intake
          </Link>
        )}
      </div>
      {intakes.length === 0 ? (
        <p className="border-t border-border px-5 py-6 text-center text-sm text-muted">No intakes on this load yet.</p>
      ) : (
        <ul className="border-t border-border">
          {intakes.map((i) => (
            <li key={i.id} className="flex items-center gap-4 border-b border-border px-5 py-2.5 text-sm last:border-b-0">
              <Link href={`/admin/stock-manager/intakes/${i.reference}`} className="font-semibold text-primary hover:text-primary-hover">
                {docNumber("intakes", i.reference)}
              </Link>
              <span className="text-muted">{options.storageAreas.find((o) => o.value === i.storage_area_id)?.label}</span>
              <span className="text-muted">{options.suppliers.find((o) => o.value === i.supplier_id)?.label}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ACT_PurchaseOrderItem_AddPOIntakeItem: pick the PO lines this delivery
// contains. A line defaults to its outstanding quantity and can be added once.
export function IntakePoLinesPanel({
  intakeId,
  purchaseOrderReference,
  poLines,
  receivedLineIds,
  options,
  canAdd,
}: {
  intakeId: string;
  purchaseOrderReference: number | null | undefined;
  poLines: DocRow[];
  receivedLineIds: string[];
  options: Options;
  canAdd: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function add(line: DocRow) {
    setError(null);
    const outstanding = Math.max(Number(line.qty_outstanding), 0);
    startTransition(async () => {
      const res = await saveLine(
        "intakes",
        intakeId,
        null,
        { qty: String(outstanding > 0 ? outstanding : 1), transaction_date: new Date().toISOString() },
        { purchase_order_item_id: line.id },
      );
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <section className="rounded-card border border-border bg-card">
      <div className="px-5 py-4">
        <h2 className={sectionHeadingClass}>
          Purchase order {purchaseOrderReference !== null && purchaseOrderReference !== undefined ? docNumber("purchase-orders", purchaseOrderReference) : ""} lines
        </h2>
        <p className="mt-1 text-xs text-muted">Add the lines that arrived. Each defaults to what is still outstanding.</p>
      </div>
      {error && (
        <p className="px-5 pb-3 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      {poLines.length === 0 ? (
        <p className="border-t border-border px-5 py-6 text-center text-sm text-muted">This purchase order has no lines.</p>
      ) : (
        <ul className="border-t border-border">
          {poLines.map((l) => {
            const onIntake = receivedLineIds.includes(l.id);
            return (
              <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-5 py-2.5 text-sm last:border-b-0">
                <span className="min-w-0 flex-1 font-medium text-ink">{options.items.find((o) => o.value === l.item_id)?.label}</span>
                <span className="text-muted">Ordered {formatQty(l.qty_ordered)}</span>
                <span className="text-muted">Received {formatQty(l.qty_received)}</span>
                <span className="text-muted">Outstanding {formatQty(l.qty_outstanding)}</span>
                {canAdd && (
                  <button
                    type="button"
                    onClick={() => add(l)}
                    disabled={isPending || onIntake}
                    className={linkButtonClass}
                    title={onIntake ? "Already on this intake" : undefined}
                  >
                    {onIntake ? "Added" : "Add"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
