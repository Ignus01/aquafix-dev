import { INCIDENT_STATUSES, STATUS_LABELS, type IncidentStatus } from "@/lib/incidents/types";
import { changedFields } from "../fields";
import type { GridSpec } from "../types";

// Incident_Overview (and Incident_Overview_PWA's "mine" view), one page at a
// time from incident_grid. The old status pills are the Status filter; Start
// and Complete are in the row menu.
export const incidentsGrid: GridSpec = {
  id: "incidents",
  view: "incident_grid",
  select:
    "id, reference, incident_type_id, incident_type_name, disables_location, location_id, location_name, comment, " +
    "image_count, note_count, status, incident_date, completed_at, created_at, created_by, created_by_name, " +
    "changed_at, changed_by, changed_by_name",
  fields: [
    { key: "ref", label: "Ref", field: "reference", filter: "number" },
    {
      key: "type",
      label: "Incident type",
      field: "incident_type_id",
      sortField: "incident_type_name",
      exportField: "incident_type_name",
      filter: "choice",
      uuidValues: true,
    },
    {
      key: "location",
      label: "Location",
      field: "location_id",
      sortField: "location_name",
      exportField: "location_name",
      filter: "choice",
      uuidValues: true,
    },
    { key: "comment", label: "Comment", filter: "text" },
    // Sorting by a per-row count would count every incident's photos.
    { key: "photos", label: "Photos", field: "image_count", filter: "number", sortable: false, hideable: true },
    {
      key: "status",
      label: "Status",
      filter: "choice",
      options: INCIDENT_STATUSES.map((value) => ({ value, label: STATUS_LABELS[value] })),
    },
    { key: "date", label: "Incident date", field: "incident_date", filter: "datetime" },
    { key: "completed", label: "Completed", field: "completed_at", filter: "datetime", hideable: true },
    {
      key: "by",
      label: "Logged by",
      field: "created_by",
      filter: "choice",
      uuidValues: true,
      sortable: false,
      exportField: "created_by_name",
    },
    ...changedFields(),
  ],
  defaultSort: { key: "changed", desc: true },
};

export type IncidentGridRow = {
  id: string;
  reference: number;
  incident_type_id: string;
  incident_type_name: string | null;
  disables_location: boolean | null;
  location_id: string;
  location_name: string | null;
  comment: string;
  image_count: number;
  note_count: number;
  status: IncidentStatus;
  incident_date: string;
  completed_at: string | null;
  created_at: string;
  created_by: string | null;
  created_by_name: string | null;
  changed_at: string;
  changed_by: string | null;
  changed_by_name: string | null;
};
