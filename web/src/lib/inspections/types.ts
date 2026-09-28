import type { InspectionValueType } from "@/lib/inspection-setup/types";
import type { FormImage, IncidentImage, NewImage } from "@/lib/incidents/types";

export const INSTRUCTION_STATUSES = ["new", "in_progress", "completed"] as const;
export type InstructionStatus = (typeof INSTRUCTION_STATUSES)[number];

// AssetManagement.ENUM_Status captions.
export const INSTRUCTION_STATUS_LABELS: Record<InstructionStatus, string> = {
  new: "New",
  in_progress: "In Progress",
  completed: "Completed",
};

export const SCHEDULE_TYPES = ["daily", "weekly", "monthly"] as const;
export type ScheduleType = (typeof SCHEDULE_TYPES)[number];

export const SCHEDULE_TYPE_LABELS: Record<ScheduleType, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

// ISO weekdays, as stored in scheduled_instruction.week_days.
export const WEEK_DAYS: { value: number; short: string; label: string }[] = [
  { value: 1, short: "Mon", label: "Monday" },
  { value: 2, short: "Tue", label: "Tuesday" },
  { value: 3, short: "Wed", label: "Wednesday" },
  { value: 4, short: "Thu", label: "Thursday" },
  { value: 5, short: "Fri", label: "Friday" },
  { value: 6, short: "Sat", label: "Saturday" },
  { value: 7, short: "Sun", label: "Sunday" },
];

export type GradingBadgeData = { id: string; name: string; hex_colour: string | null };

export type AccountOption = { id: string; username: string; email: string };

// Assets as the pickers and grids show them.
export type AssetOption = {
  id: string;
  name: string;
  code: string;
  active: boolean;
  asset_type: { id: string; name: string };
  location: { id: string; name: string };
};

// ============================================================================
// Instructions
// ============================================================================
export type InstructionListRow = {
  id: string;
  legacy_uid: number;
  name: string;
  comment: string;
  status: InstructionStatus;
  nr_of_allocations: number;
  nr_completed: number;
  is_scheduled: boolean;
  required_completed_date: string;
  account_id: string | null;
  account_name: string | null;
  updated_at: string;
};

export type InstructionAllocation = {
  id: string;
  is_completed: boolean;
  asset: AssetOption;
  // The first activity of the instruction for this asset
  // (DS_InstructionAssetAllocation_GetInspectionActivity).
  activity: {
    id: string;
    legacy_uid: number;
    inspected_by_name: string | null;
    grading: GradingBadgeData | null;
  } | null;
};

export type InstructionDetail = InstructionListRow & {
  allocations: InstructionAllocation[];
};

export type SaveInstructionPayload = {
  id: string | null;
  name: string;
  comment: string;
  required_completed_date: string;
  account_id: string;
  asset_ids: string[];
};

export type ScheduledInstructionRow = {
  id: string;
  legacy_uid: number;
  name: string;
  comment: string;
  schedule_type: ScheduleType;
  include_weekends: boolean;
  include_public_holidays: boolean;
  day_of_month: number | null;
  week_days: number[];
  days_to_complete: number;
  active: boolean;
  account_id: string | null;
  account_name: string | null;
  asset_ids: string[];
};

export type SaveScheduledInstructionPayload = Omit<
  ScheduledInstructionRow,
  "id" | "legacy_uid" | "account_name"
> & { id: string | null };

export type ScheduleRun = {
  id: number;
  run_date: string;
  trigger: "cron" | "manual";
  status: "running" | "success" | "partial" | "failed";
  started_at: string;
  issued_count: number;
  problems: { name: string; reason: string }[];
};

export type PublicHoliday = { id: string; holiday_date: string; name: string };

// ============================================================================
// Activities and values
// ============================================================================
export type ActivityListRow = {
  id: string;
  legacy_uid: number;
  inspection_date: string;
  created_by: string | null;
  inspected_by_name: string | null;
  asset: AssetOption;
  instruction: { id: string; legacy_uid: number; name: string } | null;
  grading: GradingBadgeData | null;
};

export type ValueListRow = {
  id: string;
  display_value: string;
  is_current: boolean;
  image_count: number;
  inspection: { id: string; name: string };
  grading: GradingBadgeData | null;
  activity: {
    id: string;
    legacy_uid: number;
    inspection_date: string;
    asset: AssetOption;
  };
};

export type ActivityValue = {
  id: string;
  display_value: string;
  is_current: boolean;
  inspection: { id: string; name: string; value_type: InspectionValueType };
  grading: GradingBadgeData | null;
  images: IncidentImage[];
};

export type ActivityDetail = ActivityListRow & {
  values: ActivityValue[];
};

export type CumulativeRow = {
  id: string;
  legacy_uid: number;
  latest_value: number;
  updated_at: string;
  inspection: { id: string; name: string };
  asset: AssetOption;
};

// ============================================================================
// Capture (Inspection_NewEdit)
// ============================================================================
export type CaptureOption = {
  id: string;
  name: string;
  active: boolean;
  priority: number;
  grading: GradingBadgeData | null;
};

export type CaptureInspection = {
  id: string;
  name: string;
  description: string;
  value_type: InspectionValueType;
  is_required: boolean;
  nr_of_images_required: number;
  options: CaptureOption[];
};

// One value row on the capture page, held in memory until Save.
export type CaptureValue = {
  id: string;
  inspection_id: string;
  is_current: boolean;
  text_value: string;
  // Kept as typed so a half-typed number isn't lost; sent as a number.
  decimal_value: string;
  // ISO timestamp, or "" when not answered.
  date_value: string;
  drop_down_option_id: string;
  images: FormImage[];
};

export type CaptureContext = {
  activity: { id: string; legacy_uid: number; inspection_date: string } | null;
  asset: AssetOption;
  instruction: { id: string; legacy_uid: number; name: string } | null;
  inspections: CaptureInspection[];
  values: CaptureValue[];
};

export type SaveActivityValue = {
  id: string;
  inspection_id: string;
  is_current: boolean;
  text_value: string;
  decimal_value: number;
  date_value: string | null;
  drop_down_option_id: string | null;
  images: ({ id: string } | (NewImage & { id?: undefined }))[];
};

export type SaveActivityPayload = {
  id: string | null;
  asset_id: string;
  instruction_id: string | null;
  values: SaveActivityValue[];
};

export type SaveMessage = {
  kind: "field" | "popup";
  value_id: string;
  field?: "drop_down_option_id" | "date_value" | "text_value" | "decimal_value";
  message: string;
};

export type SaveRetry = { superseded_id: string; new_id: string; inspection_id: string };

export type SaveActivityResult =
  | { ok: true; id: string; legacy_uid: number }
  | { ok: false; messages: SaveMessage[]; retries: SaveRetry[] }
  | { ok: false; error: string };
