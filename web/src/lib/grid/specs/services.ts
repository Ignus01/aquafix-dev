import { SERVICE_TYPE_LABELS, type ServiceType } from "@/lib/services/types";
import { changedFields } from "../fields";
import type { GridSpec } from "../types";

// Service_Overview, one page at a time from service_grid.
export const servicesGrid: GridSpec = {
  id: "services",
  view: "service_grid",
  select:
    "id, reference, asset_id, asset_code, asset_name, due_date, service_type, is_completed, completed_date, " +
    "supplier_id, supplier_name, performed_by, invoice_nr, total_part_cost, total_labour_cost, total_cost, comment, " +
    "changed_at, changed_by, changed_by_name",
  fields: [
    { key: "uid", label: "UID", field: "reference", filter: "number" },
    { key: "asset", label: "Asset code", field: "asset_code", filter: "text" },
    { key: "asset_name", label: "Asset", field: "asset_name", filter: "text", hideable: true },
    { key: "due", label: "Due date", field: "due_date", filter: "datetime" },
    {
      key: "type",
      label: "Service type",
      field: "service_type",
      filter: "choice",
      options: (Object.keys(SERVICE_TYPE_LABELS) as ServiceType[]).map((value) => ({
        value,
        label: SERVICE_TYPE_LABELS[value],
      })),
    },
    {
      key: "completed",
      label: "Completed",
      field: "is_completed",
      filter: "choice",
      options: [
        { value: "true", label: "Completed" },
        { value: "false", label: "Open" },
      ],
    },
    { key: "completed_date", label: "Completed date", field: "completed_date", filter: "datetime", hideable: true },
    {
      key: "supplier",
      label: "Supplier",
      field: "supplier_id",
      sortField: "supplier_name",
      exportField: "supplier_name",
      filter: "choice",
      uuidValues: true,
    },
    { key: "performed_by", label: "Performed by", filter: "text", hideable: true },
    { key: "invoice", label: "Invoice nr", field: "invoice_nr", filter: "text", hideable: true },
    { key: "part", label: "Part cost", field: "total_part_cost", filter: "number", hideable: true },
    { key: "labour", label: "Labour cost", field: "total_labour_cost", filter: "number", hideable: true },
    { key: "total", label: "Total cost", field: "total_cost", filter: "number" },
    { key: "comment", label: "Comment", filter: "text", hideable: true },
    ...changedFields(),
  ],
  defaultSort: { key: "changed", desc: true },
};

// Service_Overview_PWA: open services only ([IsCompleted = false], a preset
// the export applies too), soonest due first.
export const openServicesGrid: GridSpec = {
  ...servicesGrid,
  id: "services-open",
  where: [{ field: "is_completed", eq: false }],
  // Every row is open: the status column only tells Open from Overdue.
  fields: servicesGrid.fields
    .filter((f) => f.key !== "completed_date")
    .map((f) => (f.key === "completed" ? { ...f, label: "Status", filter: undefined, sortable: false, exportField: false } : f)),
  defaultSort: { key: "due", desc: false },
};

export type ServiceGridRow = {
  id: string;
  reference: number;
  asset_id: string;
  asset_code: string | null;
  asset_name: string | null;
  due_date: string;
  service_type: ServiceType;
  is_completed: boolean;
  completed_date: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  performed_by: string | null;
  invoice_nr: string | null;
  total_part_cost: number;
  total_labour_cost: number;
  total_cost: number;
  comment: string | null;
  changed_at: string;
  changed_by: string | null;
  changed_by_name: string | null;
};
