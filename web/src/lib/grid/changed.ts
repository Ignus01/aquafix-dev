import "server-only";
import { createClient } from "@/lib/supabase/server";

// Client-mode grids load their rows through the existing list actions, not a
// *_grid view, so the Changed / Changed by columns are filled in here: the
// rows' updated_at / updated_by, plus the editor's name from get_user_names
// (one call for every list on the page). A null updated_by is a system
// write, shown as "System".

export type ChangedFields = { changed_at: string | null; changed_by: string | null; changed_by_name: string | null };

type Audited = { updated_at?: string | null; updated_by?: string | null };

export async function withChanged<L extends object[][]>(...lists: L): Promise<{ [K in keyof L]: (L[K][number] & ChangedFields)[] }> {
  const ids = new Set<string>();
  for (const rows of lists) for (const r of rows as Audited[]) if (r.updated_by) ids.add(r.updated_by);

  const names = new Map<string, string>();
  if (ids.size > 0) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("get_user_names", { p_ids: [...ids] });
    if (error) throw error;
    for (const row of (data ?? []) as { id: string; name: string }[]) names.set(row.id, row.name);
  }

  return lists.map((rows) =>
    (rows as Audited[]).map((r) => ({
      ...r,
      changed_at: r.updated_at ?? null,
      changed_by: r.updated_by ?? null,
      changed_by_name: r.updated_by ? (names.get(r.updated_by) ?? null) : null,
    })),
  ) as { [K in keyof L]: (L[K][number] & ChangedFields)[] };
}
