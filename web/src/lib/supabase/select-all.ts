import type { PostgrestError } from "@supabase/supabase-js";

// PostgREST returns at most 1000 rows a request (max_rows), which silently
// truncates any list a grid filters and sorts in the browser.
const PAGE = 1000;

type RangeableQuery<T> = {
  range(
    from: number,
    to: number,
  ): PromiseLike<{ data: T[] | null; error: PostgrestError | null }>;
};

// Pages through a select until a short page. `query` builds a fresh query each
// time; its order must be unique (end on "id") so pages don't skip or repeat.
// `parallel` pages are requested at a time, for tables with tens of thousands
// of rows.
export async function selectAll<T>(query: () => RangeableQuery<T>, { parallel = 1 } = {}): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE * parallel) {
    const pages = await Promise.all(
      Array.from({ length: parallel }, (_, i) => query().range(from + i * PAGE, from + (i + 1) * PAGE - 1)),
    );
    for (const { data, error } of pages) {
      if (error) throw error;
      rows.push(...(data ?? []));
      if (!data || data.length < PAGE) return rows;
    }
  }
}
