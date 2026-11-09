import type { MasterdataRole } from "@/lib/auth";

// Mirrors public.is_billing_admin() in 20261109140000_billing.sql. Used only to
// decide what to render — the database is the real enforcement point.
export const BILLING_ADMINS: MasterdataRole[] = ["system_admin", "admin"];

export function isBillingAdmin(roles: MasterdataRole[]) {
  return roles.some((r) => BILLING_ADMINS.includes(r));
}
