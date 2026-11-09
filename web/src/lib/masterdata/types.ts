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

// public.asset_classification: what an asset type is. Meter types drive the
// water dashboards (treated, borehole), the usage limit (borehole) and
// billing (treated, borehole, electrical).
export type AssetClassification =
  | "TREATED_METER"
  | "BOREHOLE_METER"
  | "MUNICIPAL_METER"
  | "ELECTRICAL_METER"
  | "OTHER";

export const ASSET_CLASSIFICATION_OPTIONS: { value: AssetClassification; label: string }[] = [
  { value: "TREATED_METER", label: "Treated meter" },
  { value: "BOREHOLE_METER", label: "Borehole meter" },
  { value: "MUNICIPAL_METER", label: "Municipal meter" },
  { value: "ELECTRICAL_METER", label: "Electrical meter" },
  { value: "OTHER", label: "Other" },
];

export const assetClassificationLabel = (c: string | null | undefined) =>
  ASSET_CLASSIFICATION_OPTIONS.find((o) => o.value === c)?.label ?? "—";

export type AssetType = {
  id: string;
  legacy_uid: number;
  name: string;
  classification: AssetClassification;
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

export type Asset = {
  id: string;
  legacy_uid: number;
  name: string;
  code: string;
  logger_code: string | null;
  logger_type: LoggerType | null;
  // m³ per day; only when the asset type is a borehole meter. Null = no limit.
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
