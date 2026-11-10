<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Grids

Every back-office list uses the one grid in `src/app/admin/grid/grid.tsx` (background: `docs/grid-redesign-plan.md`). Don't hand-build a `<table>` for a list.

**Layout rules `<Grid>` enforces (it throws in dev otherwise):** the first column is the record ID, a link to the record's edit page (view page for read-only users) with a ⋯ row menu beside it; `Changed` and `Changed by` are the last two columns and the default sort is `-changed`. A table that can't have them sets `changedException` with the reason.

**1. Spec** (plain data, shared by server query, URL parser, client filter and export): a `GridSpec` with `id`, `fields` (`key`, `label`, `filter: "text" | "choice" | "date" | "datetime" | "number"`, `options` for fixed choices, `hideable`), `...changedFields()` from `lib/grid/fields.ts` last, and `defaultSort`. Large grids keep it in `lib/grid/specs/<area>.ts`.

**2. Pick a mode.**
- `mode="server"` for tables that grow (thousands of rows): add a `<thing>_grid` view `with (security_invoker = true)` exposing every shown, filtered and sorted value as a plain column plus `changed_at`, `changed_by`, `changed_by_name` (`public.grid_user_name`). Set `spec.view` and `spec.select`, register the spec in `lib/grid/registry.ts` (Export), and in `page.tsx` run `parseGridParams(searchParams, spec)` then `gridQuery(supabase, spec, params, { timeZone })`. Pass `result` and `params` to `<Grid>`. Index `(updated_at desc, id)` and the other common sorts.
- `mode="client"` for small tables (under ~1,000 rows): pass all `rows`. Filtering, sorting and paging run in the browser (`lib/grid/client-filter.ts`, same semantics as the server) and the state still lives in the URL (`history.replaceState`). Select `updated_at, updated_by` in the list action and run the rows through `withChanged()` (`lib/grid/changed.ts`) in the page to get the Changed fields.

**3. Columns** (`GridColumn<T>[]`, one per spec field, same `key`): `render(row)` draws the cell. In client mode each column also needs `value(row)`, which is what is filtered, sorted and exported: an id for a lookup filtered by a choice (add `sortValue` to sort by its name), `"true"`/`"false"` for yes/no choices, a list for multi-valued cells (matches if any item does). End with `...changedColumns(timeZone)`; in client mode pass `options={{ changed_by: changedByOptions(rows) }}`.

**4. `<Grid>` props:** `rowHref` (the ID link), or `onRowOpen` for small lookup tables that keep a drawer; `rowMenu` (View, Edit, …, then `{ danger: true, confirm }` Delete last; `download: true` for file links); `options` for lookup-table choices; `primaryAction` for the one "New …" button; `selection` for bulk actions; `prefix` when a page shows two grids. Tabs switched in the browser call `replaceTab()` so one tab's filters don't carry over.

Lookup-table CRUD (master data, stock master files, inspection setup, quality parameters) goes through `src/app/admin/masterdata/entity-crud-table.tsx`, which builds the spec from its field config: new tables of that kind only need a `gridId`, the fields and the actions.
