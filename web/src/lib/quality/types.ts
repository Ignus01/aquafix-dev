// Shapes of the Quality tables (supabase/migrations/20261016120000_lab_quality.sql).

export type ResultStatus = "ok" | "high" | "low" | "inconclusive" | "no_limit";

export type Lab = { id: string; name: string; active: boolean };

export type QualityParameter = {
  id: string;
  name: string;
  short_name: string | null;
  unit: string;
  min_acceptable: number | null;
  max_acceptable: number | null;
  can_be_negative: boolean;
  decimals: number;
  standard: string | null;
  sort_order: number;
  active: boolean;
};

export type LabParameterMap = {
  id: string;
  lab_id: string;
  lab_parameter: string;
  lab_unit: string | null;
  parameter_id: string | null;
  factor: number;
};

export type LabLocationMap = {
  id: string;
  lab_id: string;
  lab_locality: string;
  location_id: string | null;
};

// lab_import.parsed: the certificate as the parser read it. values[i] belongs
// to columns[i]; null is a blank cell (or text that isn't a number).
export type ParsedColumn = { header: string; unit: string };
export type ParsedRow = {
  row: number;
  lab_no: string;
  locality: string;
  sample_type: string | null;
  sampled_on: string;
  values: (number | null)[];
};
export type ParsedSheet = {
  lab_name: string;
  client_name: string | null;
  batch_no: string | null;
  columns: ParsedColumn[];
  rows: ParsedRow[];
  warnings: string[];
};

export type LabImportStatus = "staged" | "imported" | "cancelled";

export type LabImportRow = {
  id: string;
  lab_id: string | null;
  lab_name: string;
  client_name: string | null;
  batch_no: string | null;
  file_name: string;
  status: LabImportStatus;
  samples_imported: number | null;
  samples_skipped: number | null;
  created_at: string;
  created_by_name: string | null;
  imported_at: string | null;
  imported_by_name: string | null;
};

// A staged import as the import page works with it.
export type StagedImport = {
  id: string;
  file_name: string;
  lab_name: string;
  client_name: string | null;
  batch_no: string | null;
  parsed: ParsedSheet;
};

export type SampleOverview = {
  id: string;
  import_id: string;
  lab_id: string;
  location_id: string;
  location_name: string;
  lab_no: string;
  lab_locality: string | null;
  sample_type: string | null;
  sampled_on: string;
  lab_name: string;
  batch_no: string | null;
  client_name: string | null;
  file_name: string;
  imported_at: string | null;
  imported_by_name: string | null;
  results: number;
  out_of_spec: number;
  inconclusive: number;
  out_of_spec_names: string[];
};

// One row of public.lab_result_view.
export type ResultRow = {
  id: string;
  sample_id: string;
  parameter_id: string;
  raw_value: number;
  value: number;
  below_detection: boolean;
  lab_parameter: string | null;
  lab_unit: string | null;
  parameter_name: string;
  parameter_short_name: string | null;
  unit: string;
  min_acceptable: number | null;
  max_acceptable: number | null;
  decimals: number;
  sort_order: number;
  status: ResultStatus;
};

export type QualityFilter = {
  period: string;
  from: string;
  to: string;
  region: string;
  organisation: string;
  location: string;
  lab: string;
  outOfSpec: boolean;
};
