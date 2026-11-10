import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChoiceOption } from "./types";

// The users, as choice-filter options for user columns (Logged by, Changed
// by…). Any masterdata role may list them (list_subscribable_accounts).
export async function gridUserOptions(supabase: SupabaseClient): Promise<ChoiceOption[]> {
  const { data, error } = await supabase.rpc("list_subscribable_accounts");
  if (error) throw error;
  return ((data ?? []) as { id: string; username: string }[]).map((a) => ({ value: a.id, label: a.username }));
}

// A lookup table's rows as choice options, by name.
export function lookupOptions(res: { data: { id: string; name: string }[] | null; error: unknown }): ChoiceOption[] {
  if (res.error) throw res.error;
  return (res.data ?? []).map((x) => ({ value: x.id, label: x.name }));
}
