import { SCHEDULE_TYPE_LABELS, SCHEDULE_TYPES, type ScheduleType } from "@/lib/inspections/types";
import { changedFields, YES_NO } from "../fields";
import type { GridField, GridSpec } from "../types";

// The rest of the Inspections back office (Inspection_Overview tabs), read
// one page at a time from the `*_grid` views (phase 2 of the grid redesign).

// A lookup column: filtered by id (options from the lookup table), sorted
// and exported by name.
function lookup(key: string, label: string, idField: string, nameField: string, extra: Partial<GridField> = {}): GridField {
  return {
    key,
    label,
    field: idField,
    sortField: nameField,
    exportField: nameField,
    filter: "choice",
    uuidValues: true,
    ...extra,
  };
}

const assetColumns: GridField[] = [
  { key: "asset", label: "Asset", field: "asset_name", filter: "text" },
  lookup("type", "Asset type", "asset_type_id", "asset_type_name", { hideable: true }),
  lookup("location", "Location", "location_id", "location_name"),
];

type Changed = { changed_at: string; changed_by: string | null; changed_by_name: string | null };
type AssetNames = { asset_name: string | null; asset_type_name: string | null; location_name: string | null };
type Grading = { grading_name: string | null; grading_colour: string | null };

// Inspection_Overview → Inspection Activities.
export const activitiesGrid: GridSpec = {
  id: "inspection-activities",
  view: "inspection_activity_grid",
  select:
    "id, uid, instruction_uid, instruction_name, asset_name, asset_type_name, location_name, inspection_date, " +
    "inspected_by, inspected_by_name, grading_name, grading_colour, changed_at, changed_by, changed_by_name",
  fields: [
    { key: "uid", label: "UID", filter: "number" },
    { key: "instruction", label: "Instruction", field: "instruction_name", filter: "text" },
    ...assetColumns,
    { key: "date", label: "Inspection date", field: "inspection_date", filter: "datetime" },
    { key: "by", label: "Inspected by", field: "inspected_by", filter: "choice", uuidValues: true, sortable: false, exportField: "inspected_by_name" },
    lookup("grading", "Grading", "grading_id", "grading_name"),
    ...changedFields(),
  ],
  defaultSort: { key: "changed", desc: true },
};

export type ActivityGridRow = AssetNames &
  Grading &
  Changed & {
    id: string;
    uid: number;
    instruction_uid: number | null;
    instruction_name: string;
    inspection_date: string;
    inspected_by: string | null;
    inspected_by_name: string | null;
  };

// Inspection_Overview → Inspection Values (superseded Feedback attempts
// included, and marked). Counted exactly: with the RLS checks run once per
// query (20261110130000_rls_initplan) that is ~7 ms for 32k rows, while the
// planner estimate undercounts by half per RLS-protected join.
export const valuesGrid: GridSpec = {
  id: "inspection-values",
  view: "inspection_value_grid",
  select:
    "id, uid, activity_uid, inspection_date, asset_name, asset_type_name, location_name, inspection_name, " +
    "display_value, is_current, grading_name, grading_colour, image_count, changed_at, changed_by, changed_by_name",
  fields: [
    { key: "uid", label: "UID", filter: "number" },
    { key: "activity", label: "Activity", field: "activity_uid", filter: "number" },
    ...assetColumns,
    lookup("inspection", "Inspection", "inspection_id", "inspection_name"),
    { key: "value", label: "Value", field: "display_value", filter: "text" },
    {
      key: "current",
      label: "Attempt",
      field: "is_current",
      filter: "choice",
      options: [
        { value: "true", label: "Current" },
        { value: "false", label: "Superseded" },
      ],
      hideable: true,
      defaultHidden: true,
    },
    { key: "date", label: "Inspection date", field: "inspection_date", filter: "datetime" },
    lookup("grading", "Grading", "grading_id", "grading_name"),
    // Sorting by a per-row count would count every value's images.
    { key: "images", label: "Images", field: "image_count", filter: "number", sortable: false, hideable: true },
    ...changedFields(),
  ],
  defaultSort: { key: "changed", desc: true },
};

export type ValueGridRow = AssetNames &
  Grading &
  Changed & {
    id: string;
    uid: number;
    activity_uid: number;
    inspection_date: string;
    inspection_name: string | null;
    display_value: string;
    is_current: boolean;
    image_count: number;
  };

// Inspection_Overview → Cumulative Values.
export const cumulativeGrid: GridSpec = {
  id: "inspection-cumulative-values",
  view: "inspection_cumulative_value_grid",
  select:
    "id, uid, asset_name, asset_type_name, location_name, inspection_name, latest_value, changed_at, changed_by, changed_by_name",
  fields: [
    { key: "uid", label: "UID", filter: "number" },
    ...assetColumns,
    lookup("inspection", "Inspection", "inspection_id", "inspection_name"),
    { key: "value", label: "Latest value", field: "latest_value", filter: "number" },
    ...changedFields(),
  ],
  defaultSort: { key: "changed", desc: true },
};

export type CumulativeGridRow = AssetNames &
  Changed & {
    id: string;
    uid: number;
    inspection_name: string | null;
    latest_value: number;
  };

// Instructions → Scheduled Instructions.
export const scheduledGrid: GridSpec = {
  id: "scheduled-instructions",
  view: "scheduled_instruction_grid",
  select:
    "id, uid, name, comment, account_id, account_name, schedule_type, include_weekends, include_public_holidays, " +
    "day_of_month, week_days, days_to_complete, asset_count, active, changed_at, changed_by, changed_by_name",
  fields: [
    { key: "uid", label: "UID", filter: "number" },
    { key: "name", label: "Name", filter: "text" },
    { key: "comment", label: "Comment", filter: "text", hideable: true },
    {
      key: "account",
      label: "Assigned to",
      field: "account_id",
      sortField: "account_name",
      exportField: "account_name",
      filter: "choice",
      uuidValues: true,
    },
    {
      key: "type",
      label: "Schedule",
      field: "schedule_type",
      filter: "choice",
      options: SCHEDULE_TYPES.map((value) => ({ value, label: SCHEDULE_TYPE_LABELS[value] })),
    },
    { key: "weekends", label: "Weekends", field: "include_weekends", filter: "choice", options: YES_NO, hideable: true },
    { key: "holidays", label: "Public holidays", field: "include_public_holidays", filter: "choice", options: YES_NO, hideable: true },
    { key: "day", label: "Day of month", field: "day_of_month", filter: "number", hideable: true },
    { key: "days", label: "Days to complete", field: "days_to_complete", filter: "number" },
    { key: "assets", label: "Assets", field: "asset_count", filter: "number" },
    {
      key: "active",
      label: "Active",
      filter: "choice",
      options: [
        { value: "true", label: "Active" },
        { value: "false", label: "Inactive" },
      ],
    },
    ...changedFields(),
  ],
  defaultSort: { key: "changed", desc: true },
};

export type ScheduledGridRow = Changed & {
  id: string;
  uid: number;
  name: string;
  comment: string;
  account_id: string | null;
  account_name: string | null;
  schedule_type: ScheduleType;
  include_weekends: boolean;
  include_public_holidays: boolean;
  day_of_month: number | null;
  week_days: number[];
  days_to_complete: number;
  asset_count: number;
  active: boolean;
};
