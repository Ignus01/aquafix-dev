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
