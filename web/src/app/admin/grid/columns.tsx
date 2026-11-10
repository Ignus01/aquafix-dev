"use client";

import type { ReactNode } from "react";
import { formatDateTime } from "@/lib/incidents/format";
import type { CellValue } from "@/lib/grid/client-filter";
import { SYSTEM_OPTION } from "@/lib/grid/fields";
import type { ChoiceOption } from "@/lib/grid/types";

// Client-side half of a grid column: how a cell renders. Everything else
// (label, filter, sort field) is in the column's GridField in the spec.
export type GridColumn<T> = {
  key: string;
  render: (row: T) => ReactNode;
  // Client mode: the value filtered, sorted and exported.
  value?: (row: T) => CellValue;
  // Client mode: what the column sorts on, when not `value` (a lookup that
  // filters on its id but sorts by its name).
  sortValue?: (row: T) => CellValue;
  className?: string;
  align?: "right";
};

export type Changed = { changed_at: string | null; changed_by_name: string | null; changed_by?: string | null };

// The Changed and Changed by cells every grid ends with.
export function changedColumns<T extends Changed>(timeZone: string): GridColumn<T>[] {
  return [
    {
      key: "changed",
      value: (r) => r.changed_at,
      render: (r) => <span className="text-muted tabular-nums">{formatDateTime(r.changed_at, timeZone)}</span>,
    },
    {
      key: "changed_by",
      value: (r) => r.changed_by ?? null,
      sortValue: (r) => r.changed_by_name ?? "System",
      render: (r) => <span className="text-muted">{r.changed_by_name ?? "System"}</span>,
    },
  ];
}

// Client mode: the Changed by filter offers the people who changed the
// loaded rows, plus System when some rows have no updated_by.
export function changedByOptions(rows: Changed[]): ChoiceOption[] {
  const names = new Map<string, string>();
  let system = false;
  for (const r of rows) {
    if (r.changed_by) names.set(r.changed_by, r.changed_by_name ?? r.changed_by);
    else system = true;
  }
  const options = [...names]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return system ? [...options, SYSTEM_OPTION] : options;
}

export function Dash() {
  return <span className="text-muted">—</span>;
}
