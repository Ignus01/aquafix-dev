import type { MasterdataRole } from "@/lib/auth";

// Mirrors the RLS policies in supabase/migrations/20261016120000_lab_quality.sql.
// Used only to decide what to render — the database is the real enforcement
// point.

export const QUALITY_READERS: MasterdataRole[] = ["system_admin", "admin", "user", "viewer"];
// Import files, edit mappings, parameters and labs, delete imports and samples.
export const QUALITY_ADMINS: MasterdataRole[] = ["system_admin", "admin"];

export function isQualityAdmin(roles: MasterdataRole[]) {
  return roles.some((r) => QUALITY_ADMINS.includes(r));
}

export const NOT_QUALITY_ADMIN = "Only system admins and admins can import lab results.";
