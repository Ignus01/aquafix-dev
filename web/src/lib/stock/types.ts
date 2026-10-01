export type UomType = "MASS" | "VOLUME" | "LENGTH" | "TIME" | "CURRENCY" | "NODIM";
export const UOM_TYPES: UomType[] = ["MASS", "VOLUME", "LENGTH", "TIME", "CURRENCY", "NODIM"];

export type ItemTrackingMethod = "FIFO" | "LIFO";

export type ProductType = {
  id: string;
  legacy_uid: number;
  code: string;
  name: string;
  active: boolean;
};

export type UnitOfMeasure = {
  id: string;
  legacy_uid: number;
  code: string;
  name: string;
  uom_type: UomType;
  active: boolean;
};

export type Product = {
  id: string;
  legacy_uid: number;
  code: string;
  name: string;
  active: boolean;
  product_type_id: string;
  uom_id: string;
  product_type: { name: string } | null;
  uom: { code: string } | null;
};

export type PackType = {
  id: string;
  legacy_uid: number;
  name: string;
  qty: number;
  code: string | null;
  active: boolean;
  uom_id: string;
  uom: { code: string } | null;
};

export type StorageArea = {
  id: string;
  legacy_uid: number;
  code: string;
  name: string;
  active: boolean;
  location_id: string;
  location: { name: string } | null;
};

export type Item = {
  id: string;
  legacy_uid: number;
  name: string;
  code: string | null;
  conversion_to_default_uom: number;
  item_tracking_method: ItemTrackingMethod;
  active: boolean;
  product_id: string;
  pack_type_id: string;
  pack_type: { name: string; code: string | null } | null;
};

export type Barcode = {
  id: string;
  barcode: string;
  item_id: string;
};

export type SupplierItem = {
  id: string;
  is_default: boolean;
  default_lead_time: number;
  default_price_exc_vat: number;
  item_id: string;
  supplier_id: string;
  supplier: { name: string } | null;
};

export type UomConversion = {
  id: string;
  code: string | null;
  conversion: number;
  from_uom_id: string;
  to_uom_id: string;
  to_uom: { code: string; name: string } | null;
};
