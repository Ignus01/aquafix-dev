import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type MasterdataRole = "system_admin" | "admin" | "user" | "viewer";

// The signed-in user, looked up once per request. Pages call requireRole()
// and then several data loaders that each call it again; without the cache
// every call was another round trip to Supabase Auth (and could hit its
// rate limit).
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

// Reads the caller's own role rows (RLS: `user_masterdata_roles_select_own`),
// so this only ever returns the signed-in user's own roles.
export const getCurrentUserRoles = cache(async (): Promise<MasterdataRole[]> => {
  const user = await getCurrentUser();
  if (!user) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_masterdata_roles")
    .select("role");
  if (error) throw error;

  return (data ?? []).map((row) => row.role as MasterdataRole);
});

// Redirects to /login (no session) or /admin/unauthorized (signed in, wrong
// role) unless the caller holds one of `allowed`. Call at the top of a
// Server Component or Server Action that must be gated.
export async function requireRole(
  allowed: MasterdataRole[],
): Promise<MasterdataRole[]> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const roles = await getCurrentUserRoles();
  const authorized = roles.some((role) => allowed.includes(role));
  if (!authorized) redirect("/admin/unauthorized");

  return roles;
}
