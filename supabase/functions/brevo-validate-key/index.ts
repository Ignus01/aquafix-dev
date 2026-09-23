// brevo-validate-key — SET-R04. Checks the stored Brevo key against
// GET /v3/account and records the result. Runs after "Replace key" and on
// "Test connection". system_admin only; the key never leaves this function.

import { json, requireSystemAdmin, serviceClient } from "../_shared/clients.ts";
import { checkBrevoKey } from "../_shared/brevo.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = await requireSystemAdmin(req);
  if (admin instanceof Response) return admin;

  const db = serviceClient();
  const { data: config, error } = await db.rpc("get_email_config");
  if (error || !config) return json({ error: "Could not load settings." }, 500);
  if (!config.api_key) return json({ status: "not_configured", account: null, message: null });

  const check = await checkBrevoKey(config.api_key);
  const { error: recordError } = await db.rpc("record_brevo_key_check", {
    p_status: check.status,
    p_account: check.account,
  });
  if (recordError) return json({ error: "Could not save the result." }, 500);

  return json(check);
});
