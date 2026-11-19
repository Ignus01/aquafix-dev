// Collect (MWTS spec R3): one tap, "Collected", receives an open purchase
// order into its Deliver to storage area. Like every Save it is one write
// transaction: the local copies (the order's lines show what is left at
// once, and a fully collected order leaves the Collect list) plus one outbox
// row, sent as one receive_purchase_order call. The command id makes a
// resend after a lost response return the first result, so going offline
// never receives an order twice.
import type { CommonPowerSyncDatabase } from "@powersync/react-native";
import { STOCK_DOCUMENT_BUCKET } from "../config";
import { nowIso } from "../domain/dates";
import { type FormPhoto, recordFreshPhotos } from "../photos/photos";
import { newId, queueCommand, resolveAttention } from "./outbox";
import type { CollectPayload } from "./types";

export type CollectLine = { purchase_order_item_id: string; qty: number };

export type CollectInput = {
  purchase_order_id: string;
  storage_area_id: string;
  delivery_note: string;
  lines: CollectLine[];
  photos: FormPhoto[];
};

// The form's checks; the server checks again.
export function validateCollect(input: Omit<CollectInput, "photos">): string | null {
  if (!input.storage_area_id) return "Choose where the stock goes.";
  if (input.lines.some((l) => !Number.isFinite(l.qty) || l.qty < 0)) return "Each quantity must be a number of 0 or more.";
  if (!input.lines.some((l) => l.qty > 0)) return "Enter a quantity for at least one line.";
  return null;
}

export async function collectPurchaseOrder(
  db: CommonPowerSyncDatabase,
  input: CollectInput,
  opts: { attentionId?: string | null },
): Promise<void> {
  const capturedAt = nowIso();
  const payload: CollectPayload = {
    command_id: newId(),
    captured_at: capturedAt,
    purchase_order_id: input.purchase_order_id,
    storage_area_id: input.storage_area_id,
    load_id: newId(),
    intake_id: newId(),
    delivery_note: input.delivery_note.trim() || null,
    lines: input.lines.filter((l) => l.qty > 0).map((l) => ({ id: newId(), ...l })),
    documents: input.photos
      .filter((p) => !p.serverId)
      .map((p) => ({
        name: `delivery-note-${p.photoId}.jpg`,
        storage_path: p.storage_path,
        thumbnail_path: p.thumbnail_path,
        mime_type: p.mime_type,
        size_bytes: p.size_bytes,
      })),
  };

  await db.writeTransaction(async (tx) => {
    // Local copies until the next sync brings the server's: received goes up,
    // a line with nothing left is completed, an order with no open line too.
    for (const l of payload.lines) {
      await tx.execute(
        `UPDATE purchase_order_item
            SET qty_received = coalesce(qty_received, 0) + ?,
                qty_outstanding = coalesce(qty_ordered, 0) - (coalesce(qty_received, 0) + ?),
                status = CASE WHEN coalesce(qty_received, 0) + ? >= coalesce(qty_ordered, 0) THEN 'completed' ELSE status END
          WHERE id = ?`,
        [l.qty, l.qty, l.qty, l.purchase_order_item_id],
      );
    }
    const open = await tx.getOptional("SELECT id FROM purchase_order_item WHERE purchase_order_id = ? AND status = 'new'", [
      input.purchase_order_id,
    ]);
    if (!open) await tx.execute("UPDATE purchase_order SET status = 'completed' WHERE id = ?", [input.purchase_order_id]);

    await recordFreshPhotos(tx, STOCK_DOCUMENT_BUCKET, input.photos, capturedAt);
    await resolveAttention(tx, opts.attentionId);
    await queueCommand(tx, { command: "receive_purchase_order", payload }, capturedAt);
  });
}
