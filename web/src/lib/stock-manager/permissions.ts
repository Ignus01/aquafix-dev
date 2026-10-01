import type { MasterdataRole } from "@/lib/auth";
import type { DocKind } from "./docs";

// Mirrors the RLS policies in supabase/migrations/20261001120000_stock_manager.sql.
// Used only to decide what to render — the database is the real enforcement point.

const ALL: MasterdataRole[] = ["system_admin", "admin", "user", "viewer"];
const ADMINS: MasterdataRole[] = ["system_admin", "admin"];
const WRITERS: MasterdataRole[] = ["system_admin", "admin", "user"];
const RECEIVERS: MasterdataRole[] = ["system_admin"];

type Rights = { read: MasterdataRole[]; create: MasterdataRole[]; update: MasterdataRole[]; delete: MasterdataRole[] };

export const STOCK_DOC_RIGHTS: Record<DocKind, Rights & { lineCreate: MasterdataRole[]; lineDelete: MasterdataRole[] }> = {
  // user edits orders and lines but can't create or delete them.
  "purchase-orders": { read: ALL, create: ADMINS, update: WRITERS, delete: ADMINS, lineCreate: ADMINS, lineDelete: ADMINS },
  // Receiving is system_admin-only.
  loads: { read: RECEIVERS, create: RECEIVERS, update: RECEIVERS, delete: RECEIVERS, lineCreate: RECEIVERS, lineDelete: RECEIVERS },
  intakes: { read: RECEIVERS, create: RECEIVERS, update: RECEIVERS, delete: RECEIVERS, lineCreate: RECEIVERS, lineDelete: RECEIVERS },
  // viewer can't see transfers.
  transfers: { read: WRITERS, create: WRITERS, update: WRITERS, delete: ADMINS, lineCreate: WRITERS, lineDelete: ADMINS },
  "work-orders": { read: ALL, create: WRITERS, update: WRITERS, delete: ADMINS, lineCreate: WRITERS, lineDelete: ADMINS },
  "stock-takes": { read: ALL, create: WRITERS, update: WRITERS, delete: ADMINS, lineCreate: WRITERS, lineDelete: ADMINS },
};

export const STOCK_READERS: MasterdataRole[] = ALL;

export type DocAction = keyof Rights | "lineCreate" | "lineDelete";

export function canDoc(roles: MasterdataRole[], kind: DocKind, action: DocAction): boolean {
  return STOCK_DOC_RIGHTS[kind][action].some((r) => roles.includes(r));
}

export function canReceive(roles: MasterdataRole[]): boolean {
  return RECEIVERS.some((r) => roles.includes(r));
}
