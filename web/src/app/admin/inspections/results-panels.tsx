"use client";

import Link from "next/link";
import { useState } from "react";
import { formatDateTime } from "@/lib/incidents/format";
import { SYSTEM_OPTION } from "@/lib/grid/fields";
import {
  activitiesGrid,
  cumulativeGrid,
  valuesGrid,
  type ActivityGridRow,
  type CumulativeGridRow,
  type ValueGridRow,
} from "@/lib/grid/specs/inspections";
import type { ChoiceOption, GridParams, GridResult } from "@/lib/grid/types";
import { changedColumns, Dash, type GridColumn } from "../grid/columns";
import { Grid } from "../grid/grid";
import type { RowMenuItem } from "../grid/row-menu";
import { deleteActivity } from "./actions";
import { GradingBadge } from "./badges";

// Inspection_Overview → Inspection Activities / Values / Cumulative Values,
// each one page at a time from its *_grid view.

export type InspectionLookups = Record<"location" | "type" | "inspection" | "grading", ChoiceOption[]>;

type PanelProps<T> = {
  result: GridResult<T>;
  params: GridParams;
  lookups: InspectionLookups;
  userOptions: ChoiceOption[];
  canEdit: boolean;
  timeZone: string;
};

const activityHref = (uid: number) => `/admin/inspections/activities/${uid}`;

function grading(r: { grading_name: string | null; grading_colour: string | null }) {
  return <GradingBadge grading={r.grading_name ? { id: "", name: r.grading_name, hex_colour: r.grading_colour } : null} />;
}

function copyLink(href: string): RowMenuItem {
  return { label: "Copy link", onSelect: () => navigator.clipboard?.writeText(`${window.location.origin}${href}`) };
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? <p className="mb-4 border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">{error}</p> : null;
}

export function ActivitiesPanel({ result, params, lookups, userOptions, canEdit, timeZone }: PanelProps<ActivityGridRow>) {
  const [error, setError] = useState<string | null>(null);

  const columns: GridColumn<ActivityGridRow>[] = [
    { key: "uid", render: (r) => r.uid },
    {
      key: "instruction",
      render: (r) =>
        r.instruction_uid ? (
          <Link href={`/admin/inspections/instructions/${r.instruction_uid}`} className="hover:text-primary">
            {r.instruction_name}
          </Link>
        ) : (
          <span className="text-muted">Ad hoc</span>
        ),
    },
    { key: "asset", render: (r) => r.asset_name ?? <Dash /> },
    { key: "type", render: (r) => r.asset_type_name ?? <Dash /> },
    { key: "location", render: (r) => r.location_name ?? <Dash /> },
    { key: "date", render: (r) => formatDateTime(r.inspection_date, timeZone) },
    { key: "by", render: (r) => r.inspected_by_name ?? <Dash /> },
    { key: "grading", render: grading },
    ...changedColumns<ActivityGridRow>(timeZone),
  ];

  function menu(r: ActivityGridRow): RowMenuItem[] {
    const items: RowMenuItem[] = [{ label: "View", href: activityHref(r.uid) }, copyLink(activityHref(r.uid))];
    if (canEdit) {
      items.push({
        label: "Delete",
        danger: true,
        confirm: `Inspection ${r.uid} of ${r.asset_name ?? "this asset"} will be deleted, with its values and photos. This can't be undone.`,
        onSelect: async () => {
          setError(null);
          const res = await deleteActivity(r.id);
          if (res.error) setError(res.error);
        },
      });
    }
    return items;
  }

  return (
    <>
      <ErrorLine error={error} />
      <Grid
        mode="server"
        spec={activitiesGrid}
        result={result}
        params={params}
        columns={columns}
        getKey={(r) => r.id}
        title="Inspection activities"
        timeZone={timeZone}
        // Activities are edited through capture (IAC-R06); their page offers
        // Edit when the caller may.
        rowHref={(r) => activityHref(r.uid)}
        rowLabel={(r) => `inspection ${r.uid}`}
        rowMenu={menu}
        options={{ ...lookups, by: userOptions, changed_by: [...userOptions, SYSTEM_OPTION] }}
        emptyLabel="No inspections have been taken yet."
      />
    </>
  );
}

// Superseded Feedback attempts are listed too, marked (Mendix showed them
// without a marker).
export function ValuesPanel({ result, params, lookups, userOptions, canEdit, timeZone }: PanelProps<ValueGridRow>) {
  const editHref = (r: ValueGridRow) => `/admin/inspections/values/${r.uid}/edit`;

  const columns: GridColumn<ValueGridRow>[] = [
    { key: "uid", render: (r) => r.uid },
    {
      key: "activity",
      render: (r) => (
        <Link href={activityHref(r.activity_uid)} className="font-mono text-[13px] text-primary hover:text-primary-hover">
          {r.activity_uid}
        </Link>
      ),
    },
    { key: "asset", render: (r) => r.asset_name ?? <Dash /> },
    { key: "type", render: (r) => r.asset_type_name ?? <Dash /> },
    { key: "location", render: (r) => r.location_name ?? <Dash /> },
    { key: "inspection", render: (r) => r.inspection_name ?? <Dash /> },
    {
      key: "value",
      render: (r) => (
        <span className="inline-flex items-center gap-2">
          <span className="line-clamp-1 max-w-[220px]" title={r.display_value}>
            {r.display_value || <Dash />}
          </span>
          {!r.is_current && (
            <span className="rounded-full bg-black/[.05] px-2 py-0.5 text-[11px] font-medium text-muted">superseded</span>
          )}
        </span>
      ),
    },
    { key: "current", render: (r) => (r.is_current ? "Current" : "Superseded") },
    { key: "date", render: (r) => formatDateTime(r.inspection_date, timeZone) },
    { key: "grading", render: grading },
    {
      key: "images",
      align: "right",
      render: (r) =>
        r.image_count > 0 ? (
          <Link href={activityHref(r.activity_uid)} className="text-primary hover:text-primary-hover">
            {r.image_count} photo{r.image_count === 1 ? "" : "s"}
          </Link>
        ) : (
          "0"
        ),
    },
    ...changedColumns<ValueGridRow>(timeZone),
  ];

  return (
    <Grid
      mode="server"
      spec={valuesGrid}
      result={result}
      params={params}
      columns={columns}
      getKey={(r) => r.id}
      title="Inspection values"
      timeZone={timeZone}
      rowHref={(r) => (canEdit ? editHref(r) : activityHref(r.activity_uid))}
      rowLabel={(r) => `value ${r.uid}`}
      rowMenu={(r) => [
        { label: "View activity", href: activityHref(r.activity_uid) },
        ...(canEdit ? [{ label: "Edit", href: editHref(r) }] : []),
        copyLink(activityHref(r.activity_uid)),
      ]}
      options={{ ...lookups, changed_by: [...userOptions, SYSTEM_OPTION] }}
      emptyLabel="No inspection values yet."
    />
  );
}

export function CumulativePanel({ result, params, lookups, userOptions, canEdit, timeZone }: PanelProps<CumulativeGridRow>) {
  const editHref = (r: CumulativeGridRow) => `/admin/inspections/cumulative/${r.uid}/edit`;

  const columns: GridColumn<CumulativeGridRow>[] = [
    { key: "uid", render: (r) => r.uid },
    { key: "asset", render: (r) => r.asset_name ?? <Dash /> },
    { key: "type", render: (r) => r.asset_type_name ?? <Dash /> },
    { key: "location", render: (r) => r.location_name ?? <Dash /> },
    { key: "inspection", render: (r) => r.inspection_name ?? <Dash /> },
    { key: "value", align: "right", render: (r) => <span className="font-semibold tabular-nums">{r.latest_value}</span> },
    ...changedColumns<CumulativeGridRow>(timeZone),
  ];

  return (
    <Grid
      mode="server"
      spec={cumulativeGrid}
      result={result}
      params={params}
      columns={columns}
      getKey={(r) => r.id}
      title="Cumulative values"
      timeZone={timeZone}
      // No page of its own: viewers see everything there is in the grid.
      rowHref={(r) => (canEdit ? editHref(r) : `/admin/inspections?tab=cumulative&f.uid=${r.uid}`)}
      rowLabel={(r) => `cumulative value ${r.uid}`}
      rowMenu={canEdit ? (r) => [{ label: "Edit", href: editHref(r) }] : undefined}
      options={{ ...lookups, changed_by: [...userOptions, SYSTEM_OPTION] }}
      emptyLabel="No cumulative readings yet."
    />
  );
}
