# Grid redesign: development plan

Handoff brief for a Claude Code session. Read this whole file before writing code.
Visual reference (wireframes, measurements): https://claude.ai/artifact/HWgzDNjoQais7XwQXvQR5N

## Status (10 Nov 2026)

Phases 0–2 are done on branch `claude/grid-redesign-impl-83bd8b` (not merged or pushed, no `db push`). Phases 3–4 are still open.
Measured on the local stack (31,920 values, 11,147 activities, 3,623 instructions) in `next dev`, warm:
every Inspections tab answers in 160–300 ms, with 110–140 KB of HTML for 50 rows (85 KB for 20).

Where the implementation differs from the plan below:
- The name function is `public.grid_user_name(uuid)`. `public.user_display_name` already exists for the services trigger, which relies on it returning null.
- Counts are exact everywhere. With the RLS InitPlan fix, an exact count of all values takes about 7 ms, while PostgREST's estimate undercounts by half for every RLS-protected join (it showed 7,981 for 31,920 rows). `GridSpec.estimateCount` is kept for Logger readings (phase 3).
- `inspection_value` has no `updated_by`, so Changed by on Values is the activity's last editor.
- "New instruction" and "New schedule" are pages (`/instructions/new`, `/schedules/new`), so the grids no longer load every asset for the editor.
- Activities keep their existing capture edit route (IAC-R06). The ID opens the activity page, which offers Edit when allowed.
- 0.4 was checked locally with `explain analyze` under RLS (Values page 3 ms, filtered count 4 ms). It has not been run against production yet.

## Goal

Every list in the back office (`web/src/app/admin/**`) uses **one** grid component that looks and behaves the same:

1. **A filter inside every column**, in a filter row under the header. Each filter type has one control (see Filters).
2. **The first column is the record ID.** It is a link that opens the record's **edit page** (or the view page for read-only users). It stays sticky when the grid scrolls sideways.
3. **A ⋯ menu button sits next to the ID.** It appears on row hover, on keyboard focus, and always on touch screens. The menu holds the other actions (View, Edit, Report, Duplicate, Copy link, …, then Delete last, in red, after a divider). The trailing "Actions" column goes away.
4. **Changed (date-time) and Changed by are always the last two columns.** The default sort is Changed, newest first.
5. **Large lists load only the current page from the server, plus a total count.** Today every grid downloads its whole table and pages it in the browser.

## Why (measured 9 Nov 2026, production data)

- Inspections → Values (26,447 rows) times out after 28.7 s with Postgres error 57014. Logger data also times out (11.7 s).
- Activities sends 7.7 MB of HTML to show 20 of 11,745 rows. Instructions sends 1.27 MB for 20 of 2,228.
- Database timings, loading every row vs one page of 20 plus a count:

  | Table | Every row | Page + count |
  |---|---|---|
  | instruction | 1,035 ms | 223 ms |
  | inspection_activity | 1,615 ms | 284 ms |
  | inspection_value | 16,000 ms | 2,464 ms (exact count) / 984 ms (estimated) / 318 ms (filtered) |

- Exact counts on huge unfiltered tables are expensive. That is the Logger data timeout: `readingsQuery` already pages, but it uses `count: "exact"` on `logger_reading`.
- `inspection_value` has no index on its sort column. RLS policies call `public.is_inspection_reader()` / `has_masterdata_role(...)` once per row; they need the `(select …)` wrapper so Postgres runs them once per query.

## Ground rules

- **Read `web/AGENTS.md` first.** This is Next.js 16.3 with breaking changes. Read the relevant guide in `web/node_modules/next/dist/docs/` before using `searchParams`, route handlers, `useRouter`, `useTransition` or caching.
- **Setup:** worktrees have no `node_modules`. Run `npm ci` in `web/` (a junction to the main install breaks Turbopack). Copy `web/.env.local` from the main checkout; it points at the **hosted** Supabase project. Use Node 22 if available; on Node 20, supabase-js needs `realtime: { transport: require("ws") }` in ad-hoc scripts.
- **Data safety:** treat the hosted database as production. Read-only checks are fine: `npx supabase db query --linked -o table "explain analyze select …"` from the main checkout root. Test migrations locally (`supabase start`, `supabase migration up --local`, `supabase test db`). Never `db push` without the user asking.
- **Signing in to the app** must be done by the user in the browser pane. Don't type their credentials.
- **Commits:** one commit per task on the `claude/*` branch. Don't merge, push, `db push` or deploy unless asked. The deploy steps are in memory `deploy-process.md`.
- **Keep the existing style:** Tailwind tokens from `web/src/app/globals.css`, class strings from `web/src/app/admin/ui.ts`, icons from `web/src/app/admin/icons.tsx`, and server actions that run with the caller's session so RLS stays the real gate.
- **Checks after every task:** `npx tsc --noEmit` and `npm run lint` in `web/`, `supabase test db` if SQL changed, and a browser check of the affected grid. Ask the user to sign in first if needed. Compare the server-log timing (`preview_logs`) with the baseline above.

## Decisions (defaults adopted; the user can override)

| # | Decision | Adopted default |
|---|---|---|
| D1 | Edit page or drawer | A real edit route per record (`…/[id]/edit`). Small lookup tables (Grading, Region, Organisation, Asset type) may keep a drawer. |
| D2 | Small lists | One component with two data modes: `server` for large or growing tables, `client` for tables under ~1,000 rows. Both look identical and keep state in the URL. |
| D3 | Changed by for system writes | `updated_by` is null for system writes; show "System" (and offer it in the Changed by filter). |
| D4 | Column choice | Show/hide columns, stored per grid in `localStorage` (wrapped in try/catch). Named saved views are out of scope. |
| D5 | Narrow screens | Scroll sideways with the first column pinned and ⋯ always visible. No card layout. |
| D6 | Page size | 50 by default; 20 / 50 / 100 to choose from, remembered per grid in `localStorage`. |

## Architecture

### Files

```
web/src/app/admin/grid/
  grid.tsx            <Grid> client component: toolbar, chips, table, filter row, footer
  filters.tsx         TextFilter, ChoiceFilter (multi-select popover), DateRangeFilter (presets), NumberFilter
  row-menu.tsx        <RowMenu> ⋯ button + menu (keyboard, role-aware items, in-page delete confirm)
  confirm.tsx         in-page confirmation dialog (no window.confirm)
  use-grid-params.ts  read/write grid state in the URL; router.replace inside startTransition
  columns.tsx         idColumn(), changedColumns() helpers + shared cell renderers
web/src/lib/grid/
  types.ts            GridSpec, GridColumn, GridParams, FilterValue
  params.ts           parseGridParams(searchParams, spec) / serialize; shared by server and client
  query.ts            gridQuery(supabase, spec, params): filters, sort, range, count mode
  client-filter.ts    the same filter semantics in JS, for client mode
  registry.ts         grid id → spec (view, columns, required roles), used by the export route
web/src/app/admin/export/[grid]/route.ts   CSV/XLSX export of every filtered row (exceljs)
```

Delete `web/src/app/admin/data-grid.tsx` and `web/src/app/admin/inspections/data-table.tsx` once nothing imports them (phase 4).

### URL state (one grid per page/tab; optional `prefix` prop when a page has two grids)

```
?f.name=chem                  text: contains, case-insensitive
&f.status=new,in_progress     choice: any of (blank value = "_blank")
&f.due=2026-10-01..2026-10-31 date range; open ends allowed: "2026-10-01.." or "..2026-10-31"
&f.uid=ge:6000                number: eq|ne|gt|ge|lt|le
&sort=-changed                key, "-" = descending; default from the spec
&page=2&size=50
```

Existing params such as `tab` are preserved. A filter or sort change resets `page`. Text filters are debounced by 300 ms. While the next page loads, the old rows stay on screen, dimmed (`useTransition` pending state), with a thin progress bar.

### Column spec (shared by both modes)

```ts
type GridColumn<T> = {
  key: string;                    // URL key
  label: string;
  field?: string;                 // view column for server filter/sort; defaults to key
  filter?: "text" | "choice" | "date" | "datetime" | "number";
  options?: { value: string; label: string }[];  // choice filters: from enums/lookup tables, never by scanning rows
  sortable?: boolean;             // default true when `field` exists
  render: (row: T) => ReactNode;
  value?: (row: T) => string | number | null;    // client-mode filter/sort + export
  hideable?: boolean; defaultHidden?: boolean; className?: string;
};
// idColumn({ key, label, href: (row) => string, menu: (row) => RowMenuItem[] })
// changedColumns(): [{ key: "changed", field: "changed_at", filter: "date" }, { key: "changed_by", field: "changed_by", filter: "choice" }]
type RowMenuItem = { label: string; href?: string; onSelect?: () => void; danger?: boolean; confirm?: string; shortcut?: string };
```

`<Grid>` enforces the layout: `idColumn` first, `changedColumns()` last (fail loudly in dev if a spec breaks this).

### Server mode

- Each large grid reads from a **flat view** named `<thing>_grid`, created `with (security_invoker = true)` so RLS still applies. It exposes every displayed, filtered and sorted value as a plain column (asset name, location name, account name, …) plus `changed_at` (= `updated_at`) and `changed_by` (= `updated_by` uuid) and `changed_by_name`.
- Name resolution: views can't read `auth.users` under `security_invoker`. Add `public.user_display_name(uuid) returns text`, a stable `security definer` function using the same expression as `get_user_names` (`supabase/migrations/20260923150000_incidents_rls.sql:451`) with the same role check, returning `'System'` for null. The Changed by filter filters on the `changed_by` uuid; its options come from `get_user_names` plus "System".
- `gridQuery` builds `.from(view).select(cols, { count }).<filters>.order(field).order("id").range(…)`. Count mode `"auto"`: `exact` when any filter is active, otherwise `estimated`. The footer shows "about 26,400" when the count is estimated.
- `page.tsx` parses `searchParams` with `parseGridParams`, runs `gridQuery` and passes `{ rows, total, countIsEstimate, params }` to the client `<Grid mode="server">`.
- Indexes: `(updated_at desc, id)` on every server-mode base table (Changed is the default sort), plus each grid's other common sorts. Use `pg_trgm` GIN indexes on text columns that are filtered with "contains" on tables over ~10k rows. `pg_trgm` is not enabled yet: `create extension if not exists pg_trgm with schema extensions`.

### Client mode

The existing list action returns all rows. `<Grid mode="client">` applies `client-filter.ts` (the same semantics as `query.ts`) and keeps state in the URL the same way.

### Export

`GET /admin/export/[grid]?<same params>` looks up the registry, checks roles, pages through the view in 1,000-row chunks with the same filters and sort, and streams a CSV (or XLSX via exceljs with `&format=xlsx`). The Export button links to it.

## Phases and tasks

Each task is one commit. Check boxes as you go.

### Phase 0: database quick fixes (fixes both timeouts)

- [x] **0.1 Migration `…_grid_perf_indexes.sql`:** `inspection_value (created_at desc, id)`, `inspection_activity (inspection_date desc, id)`, and `(updated_at desc, id)` on instruction, inspection_activity, inspection_value, inspection_cumulative_value, scheduled_instruction, incident, service. (`logger_reading` has no `updated_at` and already has `(reading_at desc)`; its grid sorts by `reading_at`, and Changed/Changed by are omitted there as a recorded exception.)
- [x] **0.2 Migration `…_rls_initplan.sql`:** recreate the select (and other) policies that call a role function per row so they use `(select public.fn(...))`. Find them with `grep -n "using (public\." supabase/migrations/*.sql`; they are in inspections_rls, incidents_rls, services, stock_manager, lab_quality and logger_data. Keep the semantics identical; `supabase test db` must still pass.
- [x] **0.3 Logger readings count:** in `web/src/lib/logger-data/readings.ts`, use `estimated` when no asset or date filter is set, `exact` otherwise. Show "about N" in the pager.
- [ ] **0.4 Verify:** `explain analyze` the Values query read-only against prod before and after (locally after migration). Values and Logger data must load without error locally against hosted data once the migration is applied. Report timings to the user; they decide on `db push`.

### Phase 1: grid foundations, with Instructions as the pilot

- [x] **1.1** `lib/grid/types.ts`, `params.ts` (+ unit-level sanity check through a tiny script or test), `client-filter.ts`.
- [x] **1.2** `lib/grid/query.ts` (`gridQuery`, count mode) and `registry.ts`.
- [x] **1.3** `admin/grid/use-grid-params.ts`, `filters.tsx` (text, choice popover, date range with Today / Last 7 days / This month / Last month / Overdue presets, number).
- [x] **1.4** `admin/grid/row-menu.tsx` + `confirm.tsx`: a button with `aria-haspopup="menu"`, arrow keys, Esc returns focus to the button, items hidden by role, Delete always last with a confirmation step. The menu is portalled or `position: fixed` so it isn't clipped by the scroll container or covered by sticky cells.
- [x] **1.5** `admin/grid/grid.tsx` + `columns.tsx`: toolbar (title · count, filter chips, Clear all, Columns menu, Export, one primary action), sticky header and first column, filter row, footer with range, total, size selector and pager. Loading, no-match and empty states as in the wireframe.
- [x] **1.6** SQL: `user_display_name()` and view `instruction_grid` (uid, name, comment, account_id, account_name, nr_completed, nr_of_allocations, status, required_completed_date, is_scheduled, changed_at, changed_by, changed_by_name). Add pgTAP checks that a viewer sees the same rows through the view as through the table.
- [x] **1.7** Switch Inspections → Instructions to `<Grid mode="server">`: `listInstructions` becomes `gridQuery`. Header button: keep a single primary "New instruction" (remove the duplicate). Row menu: View, Edit, Report, Copy link, Delete.
- [x] **1.8** Edit route `/admin/inspections/instructions/[uid]/edit`: split `instruction-editor.tsx` into a form component plus the existing drawer wrapper, and render the form on the page. The ID link goes to `/edit` for admins and to the view page otherwise.
- [x] **1.9** Export route working for `instructions`.

Phase 1 is done when Instructions loads in under 1 s on production data in `next dev` (baseline 4.6–8.4 s), sends less than 100 KB of HTML (baseline 1.27 MB), filters, sort and page survive refresh and Back, and the export matches the filtered row count.

### Phase 2: the rest of Inspections (server mode)

- [x] **2.1** Activities: view `inspection_activity_grid`, grid, row menu (View, Edit, Delete), and an edit route if only the drawer exists.
- [x] **2.2** Values: view `inspection_value_grid` (asset/type/location/inspection names, grading, image count as a subquery), grid, and an edit route replacing the edit drawer.
- [x] **2.3** Cumulative values: view, grid, and an edit route.
- [x] **2.4** Scheduled: view, grid, and an edit route for schedules. Keep the "schedule runs" panel as is.
- [x] **2.5** Remove the `selectAll` list loaders these tabs no longer use. Keep `selectAll` for pickers.

Phase 2 is done when every back-office Inspections tab loads in under 1 s and sends less than 100 KB. Values and Activities are the main proof.

### Phase 3: operations grids (server mode)

- [ ] **3.1** Incidents (`incidents-view.tsx`): status pills become a Status choice filter. "Start" and "Complete" move into the row menu. ID → `/admin/incidents/[reference]/edit`.
- [ ] **3.2** Services (`services-grid.tsx`, open + all tabs). "Open" stays as a tab, which is a preset filter.
- [ ] **3.3** Logger data readings (`readings-view.tsx`) and runs (`runs-view.tsx`). Readings has no edit, so its row menu holds View asset and Copy.
- [ ] **3.4** Quality samples and imports (`samples-table.tsx`, `imports-table.tsx`).

Phase 3 is done when no Work or Quality list uses a hand-built table or `SearchInput`.

### Phase 4: setup, stock and admin (client mode)

- [ ] **4.1** Master data, all tabs via `masterdata/entity-crud-table.tsx` (one change converts all six).
- [ ] **4.2** Stock master files (`stock/product-items.tsx`, `uom-conversions.tsx`) and Stock manager lists (`stock-manager/lists.tsx`).
- [ ] **4.3** Users (`users/users-table.tsx`). Users has no `updated_at`, so use `auth.users.updated_at` through the existing admin action, or omit Changed and record the exception.
- [ ] **4.4** Billing (`billing/runs-table.tsx`, `setup-table.tsx`, `runs/[id]/invoices-review.tsx`).
- [ ] **4.5** Delete `data-grid.tsx` and `inspections/data-table.tsx`. Add a short "Grids" section to `web/AGENTS.md` describing how to build a new grid.

Phase 4 is done when every list in the inventory uses `<Grid>`.

**Out of scope:** stock document line items (`doc-editor.tsx`), the quality import wizard preview, inspection-setup editor tables, dashboard report tables, and the printable instruction report. These are forms or reports, not lists.

## Inventory

| Grid | File | Rows | Mode | Phase |
|---|---|---|---|---|
| Inspections → Instructions | `inspections/instructions-panel.tsx` | 2,228 | server | 1 |
| Inspections → Activities / Values / Cumulative | `inspections/results-panels.tsx` | 11,745 / 26,447 / 144 | server | 2 |
| Inspections → Scheduled | `inspections/schedules-panel.tsx` | – | server | 2 |
| Incidents | `incidents/incidents-view.tsx` | 207 | server | 3 |
| Services | `services/services-grid.tsx` | 10 | server | 3 |
| Logger readings / runs | `logger-data/readings-view.tsx`, `runs-view.tsx` | large | server | 3 |
| Quality samples / imports | `quality/samples-table.tsx`, `imports-table.tsx` | 11 | server | 3 |
| Master data (6 tabs) | `masterdata/entity-crud-table.tsx` | 1,056 assets | client | 4 |
| Stock master files | `stock/product-items.tsx`, `uom-conversions.tsx` | small | client | 4 |
| Stock manager | `stock-manager/lists.tsx` | small | client | 4 |
| Users | `users/users-table.tsx` | 5 | client | 4 |
| Billing | `billing/runs-table.tsx`, `setup-table.tsx`, `runs/[id]/invoices-review.tsx` | small | client | 4 |

## How to work efficiently

- Do Phase 0 and Phase 1 in order. Phases 2–4 are independent of each other once Phase 1 is merged, so they can run in parallel sessions on separate branches.
- Build `<Grid>` against the Instructions pilot only. Don't generalise for other grids until you're converting them.
- Reuse what exists: `Pagination`'s page-list logic in `data-grid.tsx`, `FilterInput`'s number control in `inspections/data-table.tsx`, `formatDateTime` in `lib/incidents/format.ts`, and `zonedDay` / `formatPlainDate` in `lib/inspections/dates.ts`.
- Keep comments in the house style: short lines explaining *why*, with legacy screen names (for example `Inspection_Overview → …`) where the old code has them.
- When a task is done, report the measured load time and HTML size against the baseline.
