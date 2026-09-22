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

export type Location = {
  id: string;
  legacy_uid: number;
  name: string;
  active: boolean;
  transfer_type: "AUTO" | "MANUAL";
  is_stock_manager: boolean;
  is_asset_manager: boolean;
  region_id: string;
  organisation_id: string;
  region: { name: string } | null;
  organisation: { name: string } | null;
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

export type Asset = {
  id: string;
  legacy_uid: number;
  name: string;
  code: string;
  purchase_date: string | null;
  active: boolean;
  has_service_plan: boolean;
  service_interval: number;
  asset_type_id: string;
  location_id: string;
  asset_type: { name: string } | null;
  location: { name: string } | null;
};
