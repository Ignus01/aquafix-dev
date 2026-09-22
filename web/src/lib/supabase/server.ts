import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Session-bound client for server components / server actions — reads and
// writes the caller's own auth cookies, subject to RLS.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component during render — the middleware
            // already refreshes the session, so this can be safely ignored.
          }
        },
      },
    },
  );
}
