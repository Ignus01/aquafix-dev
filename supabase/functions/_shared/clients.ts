import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided
// to every Edge Function by the platform.

export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// The settings functions are called by the web app's server actions with the
// signed-in user's access token. The JWT is verified by asking Auth for the
// user, and the role by the same has_masterdata_role() check RLS uses.
export async function requireSystemAdmin(
  req: Request,
): Promise<{ id: string; email: string } | Response> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Not signed in." }, 401);

  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) return json({ error: "Not signed in." }, 401);

  const { data: isAdmin, error: roleError } = await userClient.rpc("has_masterdata_role", {
    roles: ["system_admin"],
  });
  if (roleError || isAdmin !== true) {
    return json({ error: "Only system admins can do that." }, 403);
  }

  return { id: userData.user.id, email: userData.user.email ?? "" };
}
