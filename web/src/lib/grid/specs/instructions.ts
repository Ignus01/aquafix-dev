import { INSTRUCTION_STATUS_LABELS, type InstructionStatus } from "@/lib/inspections/types";
import { changedFields, YES_NO } from "../fields";
import type { GridSpec } from "../types";

// Inspection_Overview → Instructions → Instructions.
export const instructionsGrid: GridSpec = {
  id: "instructions",
  view: "instruction_grid",
  select:
    "id, uid, name, comment, account_id, account_name, nr_completed, nr_of_allocations, status, " +
    "required_completed_date, is_scheduled, changed_at, changed_by, changed_by_name",
  fields: [
    { key: "uid", label: "UID", filter: "number" },
    { key: "name", label: "Name", filter: "text" },
    { key: "comment", label: "Comment", filter: "text", hideable: true },
    {
      key: "account",
      label: "Assigned to",
      field: "account_id",
      filter: "choice",
      uuidValues: true,
      // Sorting by a name would resolve every row's name; filter instead.
      sortable: false,
      exportField: "account_name",
    },
    {
      key: "progress",
      label: "Progress",
      field: "nr_completed",
      hideable: true,
      exportField: false,
    },
    {
      key: "status",
      label: "Status",
      filter: "choice",
      options: (Object.keys(INSTRUCTION_STATUS_LABELS) as InstructionStatus[]).map((value) => ({
        value,
        label: INSTRUCTION_STATUS_LABELS[value],
      })),
    },
    { key: "due", label: "Required completed", field: "required_completed_date", filter: "date" },
    { key: "scheduled", label: "Scheduled", field: "is_scheduled", filter: "choice", options: YES_NO, hideable: true },
    ...changedFields(),
  ],
  defaultSort: { key: "changed", desc: true },
};

export type InstructionGridRow = {
  id: string;
  uid: number;
  name: string;
  comment: string;
  account_id: string | null;
  account_name: string | null;
  nr_completed: number;
  nr_of_allocations: number;
  status: InstructionStatus;
  required_completed_date: string;
  is_scheduled: boolean;
  changed_at: string;
  changed_by: string | null;
  changed_by_name: string | null;
};
