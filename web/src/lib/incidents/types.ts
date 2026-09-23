export const INCIDENT_STATUSES = ["new", "in_progress", "completed"] as const;

export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

// AssetManagement.ENUM_Status captions.
export const STATUS_LABELS: Record<IncidentStatus, string> = {
  new: "New",
  in_progress: "In Progress",
  completed: "Completed",
};

export type IncidentTypeOption = {
  id: string;
  name: string;
  is_image_required: boolean;
  disables_location: boolean;
  active: boolean;
};

export type LocationOption = {
  id: string;
  name: string;
  active: boolean;
  is_asset_manager: boolean;
};

export type IncidentListRow = {
  id: string;
  reference: number;
  status: IncidentStatus;
  comment: string;
  incident_date: string;
  completed_at: string | null;
  created_at: string;
  created_by: string | null;
  created_by_name: string | null;
  location: { id: string; name: string };
  incident_type: { id: string; name: string; disables_location: boolean };
  image_count: number;
  note_count: number;
};

export type IncidentImage = {
  id: string;
  mime_type: string;
  created_by: string | null;
  created_at: string;
  // Short-lived signed URLs (private bucket).
  url: string | null;
  thumb_url: string | null;
};

export type IncidentNote = {
  id: string;
  body: string;
  created_at: string;
  created_by: string | null;
  created_by_name: string | null;
  images: IncidentImage[];
};

export type StatusChange = {
  id: number;
  from_status: IncidentStatus | null;
  to_status: IncidentStatus;
  changed_at: string;
  changed_by_name: string | null;
};

export type IncidentDetail = IncidentListRow & {
  incident_type: IncidentListRow["incident_type"] & { is_image_required: boolean };
  updated_at: string;
  images: IncidentImage[];
  notes: IncidentNote[];
  history: StatusChange[];
};

export type LocationStatusRow = {
  location_id: string;
  name: string;
  active: boolean;
  is_asset_manager: boolean;
  open_disabling_incident_count: number;
  is_operational: boolean;
};

// A photo uploaded to Storage but not yet linked to an incident or note.
export type NewImage = {
  storage_path: string;
  thumbnail_path: string;
  mime_type: string;
  size_bytes: number;
};

// A tile in the photo picker: an existing image (id set) or a new upload.
export type FormImage = {
  key: string;
  id: string | null;
  thumb_url: string | null;
  upload: NewImage | null;
  uploading: boolean;
  error: string | null;
};

export type SaveIncidentPayload = {
  id: string | null;
  location_id: string;
  incident_type_id: string;
  comment: string;
  images: ({ id: string } | (NewImage & { id: null }))[];
};

export type FieldErrors = Partial<Record<"incident_type_id" | "location_id" | "comment", string>>;
