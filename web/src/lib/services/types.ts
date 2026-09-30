export const SERVICE_TYPES = ["scheduled_maintenance", "repair"] as const;

export type ServiceType = (typeof SERVICE_TYPES)[number];

// AssetManagement.ENUM_Service_Type captions.
export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  scheduled_maintenance: "Scheduled maintenance",
  repair: "Repair",
};

export type ServiceListRow = {
  id: string;
  reference: number;
  service_type: ServiceType;
  due_date: string;
  is_completed: boolean;
  completed_date: string | null;
  invoice_nr: string | null;
  total_part_cost: number;
  total_labour_cost: number;
  total_cost: number;
  comment: string | null;
  performed_by: string | null;
  asset: { id: string; code: string; name: string };
  supplier: { id: string; name: string } | null;
};

export type ServiceFileRow = {
  id: string;
  name: string;
  size_bytes: number;
  created_at: string;
  created_by_name: string | null;
};

export type ServiceDetail = ServiceListRow & { files: ServiceFileRow[] };

export type AssetOption = { id: string; name: string; code: string; active: boolean };
export type SupplierOption = { id: string; name: string; active: boolean };

// An uploaded file not yet linked to a service.
export type NewFile = {
  name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number;
};

export type FormFile = {
  key: string;
  // Set for files already on the service.
  id: string | null;
  name: string;
  size_bytes: number;
  upload: NewFile | null;
  uploading: boolean;
  error: string | null;
};

export type FieldErrors = Partial<
  Record<"asset_id" | "service_type" | "due_date" | "completed_date" | "supplier_id", string>
>;

export type SaveServicePayload = {
  id: string | null;
  asset_id: string;
  service_type: ServiceType | "";
  // ISO timestamps, or "" when empty.
  due_date: string;
  is_completed: boolean;
  completed_date: string;
  supplier_id: string;
  invoice_nr: string;
  total_part_cost: number;
  total_labour_cost: number;
  comment: string;
  files: ({ id: string } | ({ id: null } & NewFile))[];
};
