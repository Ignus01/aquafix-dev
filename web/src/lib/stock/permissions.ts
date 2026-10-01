import type { MasterdataRole } from "@/lib/auth";

export type StockEntity =
  | "product"
  | "product_type"
  | "unit_of_measure"
  | "pack_type"
  | "storage_area"
  | "item"
  | "barcode"
  | "supplier_item"
  | "unit_of_measure_conversion";

type Action = "read" | "create" | "update" | "delete";

const ALL: MasterdataRole[] = ["system_admin", "admin", "user", "viewer"];
const ADMINS: MasterdataRole[] = ["system_admin", "admin"];
const WRITERS: MasterdataRole[] = ["system_admin", "admin", "user"];

const ADMIN_ONLY = { read: ALL, create: ADMINS, update: ADMINS, delete: ADMINS };

// Mirrors the RLS policies in supabase/migrations/20260930140000_stock_masterdata.sql.
// Used only to decide which buttons to render — the database is the real
// enforcement point.
export const STOCK_PERMISSIONS: Record<StockEntity, Record<Action, MasterdataRole[]>> = {
  product: ADMIN_ONLY,
  product_type: ADMIN_ONLY,
  unit_of_measure: ADMIN_ONLY,
  pack_type: ADMIN_ONLY,
  barcode: ADMIN_ONLY,
  supplier_item: ADMIN_ONLY,
  unit_of_measure_conversion: ADMIN_ONLY,
  // `user` creates and edits storage areas, but can't delete them.
  storage_area: { read: ALL, create: WRITERS, update: WRITERS, delete: ADMINS },
  // `user` edits existing items, but can't create or delete them.
  item: { read: ALL, create: ADMINS, update: WRITERS, delete: ADMINS },
};

export function canStock(roles: MasterdataRole[], entity: StockEntity, action: Action): boolean {
  return STOCK_PERMISSIONS[entity][action].some((r) => roles.includes(r));
}
