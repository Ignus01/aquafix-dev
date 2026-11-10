"use client";

import type { ReactNode } from "react";
import { formatDateTime } from "@/lib/incidents/format";
import type { CellValue } from "@/lib/grid/client-filter";

// Client-side half of a grid column: how a cell renders. Everything else
// (label, filter, sort field) is in the column's GridField in the spec.
export type GridColumn<T> = {
  key: string;
  render: (row: T) => ReactNode;
  // Client mode: the value filtered, sorted and exported.
  value?: (row: T) => CellValue;
  className?: string;
  align?: "right";
};

type Changed = { changed_at: string | null; changed_by_name: string | null; changed_by?: string | null };

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
      render: (r) => <span className="text-muted">{r.changed_by_name ?? "System"}</span>,
    },
  ];
}

export function Dash() {
  return <span className="text-muted">—</span>;
}
