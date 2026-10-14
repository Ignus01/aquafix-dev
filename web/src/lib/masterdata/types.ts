export type Region = {
  id: string;
  legacy_uid: number;
  name: string;
  active: boolean;
};

export type Organisation = {
  id: string;
  legacy_uid: number;
  name: string;
  active: boolean;
  is_supplier: boolean;
  is_service_supplier: boolean;
};

export type AssetType = {
  id: string;
  legacy_uid: number;
  name: string;
  classification: "FLEET" | "OTHER";
  active: boolean;
};

// public.target_band_colour: the fixed colours a location's target bands use.
export type TargetBandColour = "blue" | "green" | "orange" | "red" | "grey";

// One of a location's colour bands: covers from_pct (inclusive) of the
// volume target up to the next band's from_pct.
export type TargetBand = {
  from_pct: number;
  colour: TargetBandColour;
  label: string | null;
};

export type Location = {
  id: string;
  legacy_uid: number;
  name: string;
  active: boolean;
  transfer_type: "AUTO" | "MANUAL";
  is_stock_manager: boolean;
  is_asset_manager: boolean;
  // Treated water the location should put through per day, m³.
  volume_target: number | null;
  region_id: string;
  organisation_id: string;
  region: { name: string } | null;
  organisation: { name: string } | null;
  // Highest from_pct first.
  target_bands: TargetBand[];
};

export type ColourContainer = {
  id: string;
  name: string;
  hex_colour: string | null;
  class_name: string;
};

export type Grading = {
  id: string;
  legacy_uid: number;
  name: string;
  priority: number;
  class_name: string;
  colour_container_id: string;
  colour_container: { name: string } | null;
};

// public.logger_type: which API an asset's logger code is pulled from.
export type LoggerType = "HYDRUS" | "DATAV8";

export const LOGGER_TYPE_OPTIONS: { value: LoggerType; label: string }[] = [
  { value: "HYDRUS", label: "Hydrus" },
  { value: "DATAV8", label: "Datav8" },
];

// public.meter_type: what an asset's volume meter measures.
export type MeterType = "treated" | "borehole" | "other";

export const METER_TYPE_OPTIONS: { value: MeterType; label: string }[] = [
  { value: "treated", label: "Treated Meter" },
  { value: "borehole", label: "Borehole Meter" },
  { value: "other", label: "Other" },
];

export type Asset = {
  id: string;
  legacy_uid: number;
  name: string;
  code: string;
  logger_code: string | null;
  logger_type: LoggerType | null;
  // Null = not a meter.
  meter_type: MeterType | null;
  // m³ per day; Borehole Meters only. Null = no limit.
  usage_limit: number | null;
  purchase_date: string | null;
  active: boolean;
  has_service_plan: boolean;
  service_interval: number;
  asset_type_id: string;
  location_id: string;
  asset_type: { name: string } | null;
  location: { name: string } | null;
};
