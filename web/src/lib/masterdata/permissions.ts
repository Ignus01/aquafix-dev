import type { MasterdataRole } from "@/lib/auth";

export type MasterdataEntity =
  | "region"
  | "organisation"
  | "asset_type"
  | "location"
  | "grading"
  | "colour_container"
  | "asset";

const ALL_ROLES: MasterdataRole[] = ["system_admin", "admin", "user", "viewer"];

// Mirrors spec/masterfiles/access-matrix.md and the RLS policies in
// supabase/migrations/20260922130000_masterdata_rls.sql. Used only to decide
// which buttons to render — the database is the real enforcement point.
export const ENTITY_PERMISSIONS: Record<
  MasterdataEntity,
  { read: MasterdataRole[]; create: MasterdataRole[]; update: MasterdataRole[]; delete: MasterdataRole[] }
> = {
  asset: {
    read: ALL_ROLES,
    create: ["system_admin", "admin", "user"],
    update: ["system_admin", "admin", "user"],
    delete: ["system_admin", "admin"],
  },
  asset_type: {
    read: ALL_ROLES,
    create: ["system_admin", "admin", "user"],
    update: ["system_admin", "admin", "user"],
    delete: ["system_admin", "admin"],
  },
  location: {
    read: ALL_ROLES,
    create: ["system_admin", "admin", "user"],
    update: ["system_admin", "admin", "user"],
    delete: ["system_admin", "admin"],
  },
  organisation: {
    read: ALL_ROLES,
    create: ["system_admin", "admin", "user"],
    update: ["system_admin", "admin", "user"],
    delete: ["system_admin", "admin"],
  },
  // `user` has no Mendix access rule on Region at all — replicated verbatim.
  region: {
    read: ["system_admin", "admin", "viewer"],
    create: ["system_admin", "admin"],
    update: ["system_admin", "admin"],
    delete: ["system_admin", "admin"],
  },
  // `user` can update existing Gradings but not create or delete them.
  grading: {
    read: ALL_ROLES,
    create: ["system_admin", "admin"],
    update: ["system_admin", "admin", "user"],
    delete: ["system_admin", "admin"],
  },
  colour_container: {
    read: ALL_ROLES,
    create: ["system_admin", "admin"],
    update: ["system_admin", "admin"],
    delete: ["system_admin", "admin"],
  },
};

export function can(
  roles: MasterdataRole[],
  entity: MasterdataEntity,
  action: "read" | "create" | "update" | "delete",
): boolean {
  return ENTITY_PERMISSIONS[entity][action].some((r) => roles.includes(r));
}
