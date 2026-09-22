import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { WebSocket } from "ws";

// supabase-js always initializes a realtime client, which needs a global
// WebSocket constructor. Node <22 doesn't provide one natively.
if (typeof globalThis.WebSocket === "undefined") {
  globalThis.WebSocket = WebSocket as unknown as typeof globalThis.WebSocket;
}

// Service-role client — bypasses RLS entirely. Never import this from a
// Client Component; `server-only` makes that a build-time error. Only use
// it inside server actions/route handlers that have already verified the
// caller holds an authorized masterdata role (see requireRole in auth.ts).
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
