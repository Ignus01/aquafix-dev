import type { MasterdataRole } from "@/lib/auth";

// Mirrors the RLS policies and RPC role checks in
// supabase/migrations/20260928130000_inspections_rls.sql. Used only to decide
// what to render — the database is the real enforcement point.

const hasAny = (roles: MasterdataRole[], allowed: MasterdataRole[]) =>
  roles.some((r) => allowed.includes(r));

export const INSPECTION_READERS: MasterdataRole[] = ["system_admin", "admin", "user", "viewer"];
// Capture (the Mendix PWA pages): user, admin, system_admin.
export const INSPECTION_WRITERS: MasterdataRole[] = ["system_admin", "admin", "user"];
export const INSPECTION_ADMINS: MasterdataRole[] = ["system_admin", "admin"];
// The back office (Inspection_Overview): admins, plus viewers read-only.
export const INSPECTION_BACK_OFFICE: MasterdataRole[] = ["system_admin", "admin", "viewer"];

export function isInspectionWriter(roles: MasterdataRole[]) {
  return hasAny(roles, INSPECTION_WRITERS);
}

export function isInspectionAdmin(roles: MasterdataRole[]) {
  return hasAny(roles, INSPECTION_ADMINS);
}

export function canSeeBackOffice(roles: MasterdataRole[]) {
  return hasAny(roles, INSPECTION_BACK_OFFICE);
}

// IAC-R06: the inspector's own activities from today.
export function canEditActivity(
  roles: MasterdataRole[],
  userId: string | null,
  activity: { created_by: string | null; inspection_date: string },
  isToday: (iso: string) => boolean,
) {
  return (
    isInspectionWriter(roles) &&
    userId !== null &&
    activity.created_by === userId &&
    isToday(activity.inspection_date)
  );
}
