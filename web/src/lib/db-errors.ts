type DbError = {
  code?: string;
  message: string;
  details?: string | null;
};

// Unique constraints whose violation has a more specific message than the
// generic "name already in use" (spec wording where the source app had one).
const UNIQUE_MESSAGES: Record<string, string> = {
  incident_type_name_key: "Must be unique — an incident type with that name already exists.",
  incident_subscription_type_user_key: "Already added — that account is already subscribed.",
  inspection_allocation_inspection_asset_type_key:
    "Already added — that inspection is already allocated to this asset type.",
  public_holiday_date_key: "There is already a public holiday on that date.",
  instruction_asset_allocation_instruction_asset_key:
    "Already added — that asset is already on this instruction.",
  // Stock masterdata.
  product_code_key: "Must be unique — a product with that code already exists.",
  product_name_key: "Must be unique — a product with that name already exists.",
  product_type_code_key: "Must be unique — a product type with that code already exists.",
  product_type_name_key: "Must be unique — a product type with that name already exists.",
  unit_of_measure_code_key: "Must be unique — a unit of measure with that code already exists.",
  unit_of_measure_name_key: "Must be unique — a unit of measure with that name already exists.",
  pack_type_name_key: "Must be unique — a pack type with that name already exists.",
  storage_area_code_key: "Must be unique — a storage area with that code already exists.",
  storage_area_name_key: "Must be unique — a storage area with that name already exists.",
  item_product_pack_type_key: "That product already has an item in that pack type.",
  barcode_barcode_key: "That barcode already belongs to an item.",
  supplier_item_item_supplier_key: "Already added — that supplier already supplies this item.",
  uom_conversion_from_to_key: "A conversion between those two units already exists.",
};

// Delete-blocking FKs, keyed "<referenced table>:<referencing table>".
const REFERENCED_MESSAGES: Record<string, string> = {
  "grading:inspection_drop_down_option":
    "This Grading has already been allocated to a Drop Down Option.",
  "grading:inspection_rule": "This Grading has already been allocated to a Rule.",
  "incident_type:feedback":
    "This Incident Type is used by an inspection rule's feedback.",
  "location:incident": "This Location is already linked to an Incident.",
  // Mendix silently cleared the type on existing incidents; blocked instead.
  "incident_type:incident": "This Incident Type is used by incidents, so it can't be deleted.",
  // Inspections (spec/inspections/_overview.md, cross-module effects).
  "asset:inspection_activity": "Cannot delete this Asset as there are inspections done on it.",
  "asset:instruction_asset_allocation": "This Asset is on an instruction, so it can't be deleted.",
  "inspection:inspection_value":
    "Cannot delete this Inspection as there has been inspections taken, rather mark it as Inactive.",
  "inspection_drop_down_option:inspection_value":
    "This drop down option has been selected in an inspection - rather mark it as inactive.",
  "grading:inspection_value": "This Grading has already been applied to an Inspection Value.",
  "grading:inspection_activity": "This Grading has already been applied.",
  "instruction:inspection_activity": "Instruction already has Inspection Activities linked to it.",
  // Services (Service_Asset / Service_OrganisationServiceSupplier).
  "asset:service": "Cannot delete this Asset as it has services.",
  "organisation:service": "This Organisation is the supplier on a service, so it can't be deleted.",
  // Stock masterdata.
  "product_type:product": "This Product Type is used by a product, so it can't be deleted.",
  "unit_of_measure:product": "This Unit Of Measure is used by a product, so it can't be deleted.",
  "unit_of_measure:pack_type": "This Unit Of Measure is used by a pack type, so it can't be deleted.",
  "product:item": "This Product has items, so it can't be deleted.",
  "pack_type:item": "This Pack Type is used by an item, so it can't be deleted.",
  "location:storage_area": "This Location has storage areas, so it can't be deleted.",
  "organisation:supplier_item": "This Organisation supplies an item, so it can't be deleted.",
};

export function friendlyError(error: DbError): string {
  const text = `${error.message} ${error.details ?? ""}`;

  if (error.code === "23505") {
    const constraint = /unique constraint "(\w+)"/.exec(text)?.[1];
    return (constraint && UNIQUE_MESSAGES[constraint]) ?? "That name is already in use.";
  }
  if (error.code === "23514")
    return "One of the values doesn't meet the required constraints.";
  if (error.code === "23503") {
    const from = /on table "(\w+)" violates/.exec(text)?.[1];
    const by = /is (?:still )?referenced from table "(\w+)"/.exec(text)?.[1];
    if (from && by && REFERENCED_MESSAGES[`${from}:${by}`]) {
      return REFERENCED_MESSAGES[`${from}:${by}`];
    }
    return by
      ? `Can't delete — still referenced by "${by}" records.`
      : "Can't delete — this record is still referenced elsewhere.";
  }
  if (error.code === "42501") {
    return error.message.includes("row-level security")
      ? "You don't have permission to do that."
      : error.message;
  }
  // P0001: validation raised by a database function (e.g. save_inspection) —
  // the message is already written for the user.
  return error.message;
}
