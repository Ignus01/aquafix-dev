// Role rules copied from web/src/lib/inspections/permissions.ts,
// web/src/lib/incidents/permissions.ts and
// web/src/lib/stock-manager/permissions.ts. They only decide what to show;
// the RPCs check permissions again on upload.

export type Role = "system_admin" | "admin" | "user" | "viewer";

const WRITERS: Role[] = ["system_admin", "admin", "user"];
const ADMINS: Role[] = ["system_admin", "admin"];
const ALL: Role[] = ["system_admin", "admin", "user", "viewer"];
const RECEIVERS: Role[] = ["system_admin"];

const hasAny = (roles: Role[], allowed: Role[]) => roles.some((r) => allowed.includes(r));

// Inspections and Instructions tiles; capture.
export const isInspectionWriter = (roles: Role[]) => hasAny(roles, WRITERS);

export const isIncidentWriter = (roles: Role[]) => hasAny(roles, WRITERS);
export const isIncidentAdmin = (roles: Role[]) => hasAny(roles, ADMINS);

// ICD-R06 / ICN-R03.
export const canAdvanceStatus = (roles: Role[], status: string) => isIncidentWriter(roles) && status !== "completed";
export const canAddNote = (roles: Role[], status: string) => isIncidentWriter(roles) && status !== "completed";

// The four stock documents the field app captures (STOCK_DOC_RIGHTS).
export type StockKind = "loads" | "transfers" | "work-orders" | "stock-takes";

export const STOCK_DOC_RIGHTS: Record<StockKind, { read: Role[]; create: Role[] }> = {
  loads: { read: RECEIVERS, create: RECEIVERS },
  transfers: { read: WRITERS, create: WRITERS },
  "work-orders": { read: ALL, create: WRITERS },
  "stock-takes": { read: ALL, create: WRITERS },
};

export const canDoc = (roles: Role[], kind: StockKind, action: "read" | "create") =>
  hasAny(roles, STOCK_DOC_RIGHTS[kind][action]);

// IAC-R06: the inspector's own activities from today.
export function canEditActivity(
  userId: string | null,
  roles: Role[],
  activity: { created_by: string | null; inspection_date: string },
  isToday: (iso: string) => boolean,
): boolean {
  return isInspectionWriter(roles) && userId !== null && activity.created_by === userId && isToday(activity.inspection_date);
}
