import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type MasterdataRole = "system_admin" | "admin" | "user" | "viewer";

// Reads the caller's own role rows (RLS: `user_masterdata_roles_select_own`),
// so this only ever returns the signed-in user's own roles.
export async function getCurrentUserRoles(): Promise<MasterdataRole[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("user_masterdata_roles")
    .select("role");
  if (error) throw error;

  return (data ?? []).map((row) => row.role as MasterdataRole);
}

// Redirects to /login (no session) or /admin/unauthorized (signed in, wrong
// role) unless the caller holds one of `allowed`. Call at the top of a
// Server Component or Server Action that must be gated.
export async function requireRole(
  allowed: MasterdataRole[],
): Promise<MasterdataRole[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const roles = await getCurrentUserRoles();
  const authorized = roles.some((role) => allowed.includes(role));
  if (!authorized) redirect("/admin/unauthorized");

  return roles;
}
