import type { LabImportStatus } from "@/lib/quality/types";
import { changedFields } from "../fields";
import type { GridField, GridSpec } from "../types";

// Quality → Lab Results, one page at a time from the lab_*_grid views.

// A lookup column: filtered by id (options from the lookup table), sorted
// and exported by name.
function lookup(key: string, label: string, idField: string, nameField: string, extra: Partial<GridField> = {}): GridField {
  return { key, label, field: idField, sortField: nameField, exportField: nameField, filter: "choice", uuidValues: true, ...extra };
}

// Samples (was: the period / region / organisation / location / lab / out
// of spec bar above a hand-built table). Changed is when the sample's file
// was imported: samples aren't edited.
export const samplesGrid: GridSpec = {
  id: "lab-samples",
  view: "lab_sample_grid",
  select:
    "id, lab_no, sampled_on, location_id, location_name, region_name, organisation_name, lab_id, lab_name, " +
    "lab_locality, batch_no, client_name, sample_type, import_id, file_name, results, out_of_spec, inconclusive, " +
    "out_of_spec_names, changed_at, changed_by, changed_by_name",
  fields: [
    { key: "lab_no", label: "Lab no", filter: "text" },
    { key: "sampled", label: "Sampled", field: "sampled_on", filter: "date" },
    lookup("location", "Location", "location_id", "location_name"),
    lookup("region", "Region", "region_id", "region_name", { hideable: true, defaultHidden: true }),
    lookup("organisation", "Organisation", "organisation_id", "organisation_name", { hideable: true, defaultHidden: true }),
    lookup("lab", "Lab", "lab_id", "lab_name"),
    { key: "locality", label: "Lab locality", field: "lab_locality", filter: "text", hideable: true, defaultHidden: true },
    { key: "batch", label: "Batch", field: "batch_no", filter: "text" },
    { key: "sample_type", label: "Sample type", filter: "text", hideable: true },
    // "Only out of spec" is `> 0`.
    { key: "out_of_spec", label: "Out of spec", filter: "number" },
    // The link after an import filters on its file(s).
    lookup("file", "File", "import_id", "file_name", { hideable: true, defaultHidden: true }),
    ...changedFields(),
  ],
  defaultSort: { key: "changed", desc: true },
};

export type SampleGridRow = {
  id: string;
  lab_no: string;
  sampled_on: string;
  location_id: string;
  location_name: string;
  region_name: string | null;
  organisation_name: string | null;
  lab_id: string;
  lab_name: string;
  lab_locality: string | null;
  batch_no: string | null;
  client_name: string | null;
  sample_type: string | null;
  import_id: string;
  file_name: string;
  results: number;
  out_of_spec: number;
  inconclusive: number;
  out_of_spec_names: string[];
  changed_at: string;
  changed_by: string | null;
  changed_by_name: string | null;
};

export const IMPORT_STATUS_LABELS: Record<LabImportStatus, string> = {
  staged: "Staged",
  imported: "Imported",
  cancelled: "Cancelled",
};

// The imported files. Changed is when the file was imported (else
// uploaded); lab_import has no updated_at.
export const importsGrid: GridSpec = {
  id: "lab-imports",
  view: "lab_import_grid",
  select:
    "id, file_name, lab_id, lab_name, batch_no, client_name, status, samples_imported, samples_skipped, created_at, " +
    "imported_at, changed_at, changed_by, changed_by_name",
  fields: [
    { key: "file", label: "File", field: "file_name", filter: "text" },
    { key: "lab", label: "Lab", field: "lab_name", filter: "text" },
    { key: "batch", label: "Batch", field: "batch_no", filter: "text" },
    { key: "client", label: "Client", field: "client_name", filter: "text", hideable: true },
    { key: "samples", label: "Samples", field: "samples_imported", filter: "number" },
    { key: "skipped", label: "Skipped", field: "samples_skipped", filter: "number", hideable: true, defaultHidden: true },
    {
      key: "status",
      label: "Status",
      filter: "choice",
      options: (Object.keys(IMPORT_STATUS_LABELS) as LabImportStatus[]).map((value) => ({
        value,
        label: IMPORT_STATUS_LABELS[value],
      })),
    },
    { key: "uploaded", label: "Uploaded", field: "created_at", filter: "datetime", hideable: true, defaultHidden: true },
    ...changedFields(),
  ],
  defaultSort: { key: "changed", desc: true },
};

export type ImportGridRow = {
  id: string;
  file_name: string;
  lab_id: string | null;
  lab_name: string;
  batch_no: string | null;
  client_name: string | null;
  status: LabImportStatus;
  samples_imported: number | null;
  samples_skipped: number | null;
  created_at: string;
  imported_at: string | null;
  changed_at: string;
  changed_by: string | null;
  changed_by_name: string | null;
};
