export const INSPECTION_VALUE_TYPES = [
  "CUMULATIVE_VALUE",
  "DATETIME",
  "DROP_DOWN",
  "DECIMAL_VALUE",
  "TEXT",
] as const;

export type InspectionValueType = (typeof INSPECTION_VALUE_TYPES)[number];

export type Inspection = {
  id: string;
  legacy_uid: number;
  name: string;
  description: string;
  value_type: InspectionValueType;
  is_required: boolean;
  active: boolean;
  nr_of_images_required: number;
};

export type DropDownOption = {
  id: string;
  name: string;
  grading_id: string;
  nr_of_images_required: number;
  priority: number;
  active: boolean;
};

export type Feedback = {
  feedback: string;
  max_nr_of_retries: number;
  auto_create_incident: boolean;
  incident_type_id: string | null;
};

export type InspectionRule = {
  id: string;
  lower_limit: number;
  upper_limit: number;
  nr_of_images_required: number;
  grading_id: string | null;
  is_first: boolean;
  feedback: Feedback | null;
};

export type InspectionAllocation = {
  id: string;
  inspection_id: string;
  asset_type_id: string;
  priority: number;
};

export type InspectionDetail = {
  inspection: Inspection;
  drop_down_options: DropDownOption[];
  rules: InspectionRule[];
  allocations: InspectionAllocation[];
};

// Payload for the save_inspection() database function. A missing/null id
// means "insert"; child rows left out of the arrays are deleted.
export type SaveInspectionPayload = {
  id: string | null;
  name: string;
  description: string;
  value_type: InspectionValueType | "";
  is_required: boolean;
  active: boolean;
  nr_of_images_required: number;
  drop_down_options: (Omit<DropDownOption, "id"> & { id: string | null })[];
  rules: (Omit<InspectionRule, "id" | "is_first"> & { id: string | null })[];
  allocations: { id: string | null; asset_type_id: string }[];
};

export type IncidentType = {
  id: string;
  legacy_uid: number;
  name: string;
  is_image_required: boolean;
  disables_location: boolean;
  active: boolean;
};

export type IncidentSubscription = {
  id: string;
  incident_type_id: string;
  user_id: string;
  updated_at: string;
};

export type Account = {
  id: string;
  username: string;
  email: string;
};

// Grading as needed by the inspection editor's pickers (with its colour).
export type GradingOption = {
  id: string;
  name: string;
  priority: number;
  hex_colour: string | null;
};

// An AssetType's allocation list, as shown on the Asset Type drawer.
export type AssetTypeAllocation = {
  id: string;
  inspection_id: string;
  priority: number;
  inspection: { name: string; active: boolean } | null;
};
