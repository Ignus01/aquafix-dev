import type { MasterdataRole } from "@/lib/auth";

export type InspectionSetupEntity =
  | "inspection"
  | "inspection_rule"
  | "inspection_drop_down_option"
  | "feedback"
  | "incident_type"
  | "incident_subscription"
  | "inspection_allocation";

type Permissions = {
  read: MasterdataRole[];
  create: MasterdataRole[];
  update: MasterdataRole[];
  delete: MasterdataRole[];
};

// Every entity in spec/inspection-setup/access-matrix.md has the same rule:
// system_admin/admin full CRUD, user/viewer read-only.
const ADMIN_ONLY_WRITE: Permissions = {
  read: ["system_admin", "admin", "user", "viewer"],
  create: ["system_admin", "admin"],
  update: ["system_admin", "admin"],
  delete: ["system_admin", "admin"],
};

// Mirrors the RLS policies in
// supabase/migrations/20260923130000_inspection_setup_rls.sql. Used only to
// decide which buttons to render — the database is the real enforcement point.
export const INSPECTION_SETUP_PERMISSIONS: Record<InspectionSetupEntity, Permissions> = {
  inspection: ADMIN_ONLY_WRITE,
  inspection_rule: ADMIN_ONLY_WRITE,
  inspection_drop_down_option: ADMIN_ONLY_WRITE,
  feedback: ADMIN_ONLY_WRITE,
  incident_type: ADMIN_ONLY_WRITE,
  incident_subscription: ADMIN_ONLY_WRITE,
  inspection_allocation: ADMIN_ONLY_WRITE,
};

export function canInspectionSetup(
  roles: MasterdataRole[],
  entity: InspectionSetupEntity,
  action: keyof Permissions,
): boolean {
  return INSPECTION_SETUP_PERMISSIONS[entity][action].some((r) => roles.includes(r));
}
