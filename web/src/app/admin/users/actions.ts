"use server";

import { revalidatePath } from "next/cache";
import { requireRole, type MasterdataRole } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

const ALL_ROLES: MasterdataRole[] = [
  "system_admin",
  "admin",
  "user",
  "viewer",
];

export type ListedUser = {
  id: string;
  email: string;
  username: string;
  phone: string | null;
  roles: MasterdataRole[];
  createdAt: string;
};

// Only system_admin manages accounts — assigning system_admin itself is
// powerful enough that this section isn't opened up to plain "admin".
export async function listUsers(): Promise<ListedUser[]> {
  await requireRole(["system_admin"]);
  const admin = createAdminClient();

  const { data: authData, error: authError } =
    await admin.auth.admin.listUsers({ perPage: 200 });
  if (authError) throw authError;

  const { data: profiles, error: profilesError } = await admin
    .from("profiles")
    .select("id, username, phone");
  if (profilesError) throw profilesError;

  const { data: roleRows, error: rolesError } = await admin
    .from("user_masterdata_roles")
    .select("user_id, role");
  if (rolesError) throw rolesError;

  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const rolesById = new Map<string, MasterdataRole[]>();
  for (const row of roleRows) {
    const list = rolesById.get(row.user_id) ?? [];
    list.push(row.role as MasterdataRole);
    rolesById.set(row.user_id, list);
  }

  return authData.users
    .map((u) => ({
      id: u.id,
      email: u.email ?? "",
      username: profileById.get(u.id)?.username ?? "(no profile)",
      phone: profileById.get(u.id)?.phone ?? null,
      roles: rolesById.get(u.id) ?? [],
      createdAt: u.created_at,
    }))
    .sort((a, b) => a.username.localeCompare(b.username));
}

export type CreateUserState = { error: string | null; success: boolean };

export async function createUser(
  _prevState: CreateUserState,
  formData: FormData,
): Promise<CreateUserState> {
  await requireRole(["system_admin"]);

  const email = String(formData.get("email") ?? "").trim();
  const username = String(formData.get("username") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const roles = formData
    .getAll("roles")
    .map(String)
    .filter((r): r is MasterdataRole =>
      ALL_ROLES.includes(r as MasterdataRole),
    );

  if (!email || !username || !password) {
    return {
      error: "Email, username and password are required.",
      success: false,
    };
  }
  if (password.length < 8) {
    return {
      error: "Password must be at least 8 characters.",
      success: false,
    };
  }

  const admin = createAdminClient();

  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
  if (createError || !created.user) {
    return { error: createError?.message ?? "Could not create user.", success: false };
  }

  const userId = created.user.id;

  const { error: profileError } = await admin.from("profiles").insert({
    id: userId,
    username,
    phone: phone || null,
  });
  if (profileError) {
    // Don't leave an orphaned auth account behind if the profile insert fails.
    await admin.auth.admin.deleteUser(userId);
    return {
      error: `Profile creation failed: ${profileError.message}`,
      success: false,
    };
  }

  if (roles.length > 0) {
    const { error: roleError } = await admin
      .from("user_masterdata_roles")
      .insert(roles.map((role) => ({ user_id: userId, role })));
    if (roleError) {
      return {
        error: `User created, but role assignment failed: ${roleError.message}`,
        success: false,
      };
    }
  }

  revalidatePath("/admin/users");
  return { error: null, success: true };
}

export async function setUserRole(
  userId: string,
  role: MasterdataRole,
  enabled: boolean,
) {
  await requireRole(["system_admin"]);
  const admin = createAdminClient();

  if (enabled) {
    const { error } = await admin
      .from("user_masterdata_roles")
      .insert({ user_id: userId, role });
    // 23505 = unique_violation (role already assigned) — not an error here.
    if (error && error.code !== "23505") throw error;
  } else {
    const { error } = await admin
      .from("user_masterdata_roles")
      .delete()
      .eq("user_id", userId)
      .eq("role", role);
    if (error) throw error;
  }

  revalidatePath("/admin/users");
}
