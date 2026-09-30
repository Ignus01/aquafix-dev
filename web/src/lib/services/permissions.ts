import type { MasterdataRole } from "@/lib/auth";

// Mirrors the RLS policies in supabase/migrations/20260930120000_services.sql.
// Used only to decide what to render — the database is the real enforcement
// point.

const hasAny = (roles: MasterdataRole[], allowed: MasterdataRole[]) =>
  roles.some((r) => allowed.includes(r));

export const SERVICE_READERS: MasterdataRole[] = ["system_admin", "admin", "user", "viewer"];
// Create, edit and delete services; add files.
export const SERVICE_WRITERS: MasterdataRole[] = ["system_admin", "admin", "user"];
// Delete files.
export const SERVICE_ADMINS: MasterdataRole[] = ["system_admin", "admin"];

export function isServiceWriter(roles: MasterdataRole[]) {
  return hasAny(roles, SERVICE_WRITERS);
}

export function isServiceAdmin(roles: MasterdataRole[]) {
  return hasAny(roles, SERVICE_ADMINS);
}
