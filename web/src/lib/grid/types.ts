// The back-office grid (docs/grid-redesign-plan.md). A grid is described by
// plain data (GridSpec) that the server query, the URL parser, the client
// filter and the export route all share; the client adds cell renderers.

export type FilterKind = "text" | "choice" | "date" | "datetime" | "number";

export const NUMBER_OPS = ["eq", "ne", "gt", "ge", "lt", "le"] as const;
export type NumberOp = (typeof NUMBER_OPS)[number];

// The choice filter's value for "no value" (null or empty).
export const BLANK = "_blank";

export type FilterValue =
  // contains, case-insensitive
  | { kind: "text"; value: string }
  // any of; BLANK matches rows with no value
  | { kind: "choice"; values: string[] }
  // inclusive calendar days (YYYY-MM-DD) in the app's time zone; either end open
  | { kind: "date" | "datetime"; from: string | null; to: string | null }
  | { kind: "number"; op: NumberOp; value: number };

export type ChoiceOption = { value: string; label: string };

export type GridField = {
  // URL key (`f.<key>`, `sort=<key>`).
  key: string;
  label: string;
  // View column to filter and sort on; defaults to `key`.
  field?: string;
  filter?: FilterKind;
  // Choice filters: fixed options (enums, yes/no). Lookup-table options are
  // passed to <Grid> at render time instead.
  options?: ChoiceOption[];
  // Choice values that must be uuids (lookup ids), so a hand-edited URL
  // can't make the query fail.
  uuidValues?: boolean;
  // View column to sort on when it differs from `field` (a lookup filtered
  // by id but sorted by name).
  sortField?: string;
  // Default true when the column has a field to sort on.
  sortable?: boolean;
  hideable?: boolean;
  defaultHidden?: boolean;
  // View column written by Export; defaults to `field`. false leaves the
  // column out of the export.
  exportField?: string | false;
};

export type SortState = { key: string; desc: boolean };

export type GridSpec = {
  id: string;
  // `<thing>_grid` view (server mode).
  view?: string;
  // Columns selected from the view.
  select?: string;
  fields: GridField[];
  defaultSort: SortState;
  // Tables too big to count exactly on every page load (inspection_value,
  // 26k+ rows): unfiltered, the total is the planner's estimate ("about N").
  // Smaller tables always count exactly (≈200 ms for 11k activities).
  estimateCount?: boolean;
  // A preset the grid always applies (a tab such as Services → Open):
  // `field = eq` on the view, for the page, the count and the export.
  where?: { field: string; eq: string | number | boolean }[];
  // Why this grid has no Changed / Changed by columns (e.g. logger_reading has
  // no updated_at). Every other grid ends with changedFields().
  changedException?: string;
};

export type GridParams = {
  filters: Record<string, FilterValue>;
  sort: SortState;
  page: number;
  size: number;
};

export const PAGE_SIZES = [20, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 50;

export type GridResult<T> = {
  rows: T[];
  total: number;
  // The total is the planner's estimate (no filter on a big table).
  countIsEstimate: boolean;
  // The page actually shown (a page past the end shows the last one).
  page: number;
};

export function fieldOf(f: GridField) {
  return f.field ?? f.key;
}

export function isSortable(f: GridField) {
  return f.sortable ?? true;
}
