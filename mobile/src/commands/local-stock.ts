// The phone's copy of stock on hand (storage_area_stock) moves with each
// Save, so the next form already offers what is left, offline too. The next
// sync replaces it with the server's figures, which come from the ledger.
import type { Transaction } from "@powersync/react-native";

export async function addLocalStock(tx: Transaction, itemId: string, areaId: string | null | undefined, qty: number): Promise<void> {
  if (!areaId || !itemId || !qty) return;
  const row = await tx.getOptional<{ id: string }>("SELECT id FROM storage_area_stock WHERE item_id = ? AND storage_area_id = ?", [itemId, areaId]);
  if (row) await tx.execute("UPDATE storage_area_stock SET qty = coalesce(qty, 0) + ? WHERE id = ?", [qty, row.id]);
  else await tx.execute("INSERT INTO storage_area_stock (id, item_id, storage_area_id, qty, base_qty) VALUES (uuid(), ?, ?, ?, 0)", [itemId, areaId, qty]);
}

export async function setLocalStock(tx: Transaction, itemId: string, areaId: string | null | undefined, qty: number): Promise<void> {
  if (!areaId || !itemId) return;
  const row = await tx.getOptional<{ id: string }>("SELECT id FROM storage_area_stock WHERE item_id = ? AND storage_area_id = ?", [itemId, areaId]);
  if (row) await tx.execute("UPDATE storage_area_stock SET qty = ? WHERE id = ?", [qty, row.id]);
  else await tx.execute("INSERT INTO storage_area_stock (id, item_id, storage_area_id, qty, base_qty) VALUES (uuid(), ?, ?, ?, 0)", [itemId, areaId, qty]);
}
