import { BLANK, type ChoiceOption, type GridField } from "./types";

export const YES_NO: ChoiceOption[] = [
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];

// Changed and Changed by: always the grid's last two columns (the default
// sort is Changed, newest first). Changed by filters on the user id; its
// options are the users plus "System" (BLANK: system writes leave
// updated_by null).
export function changedFields(): GridField[] {
  return [
    { key: "changed", label: "Changed", field: "changed_at", filter: "datetime" },
    {
      key: "changed_by",
      label: "Changed by",
      field: "changed_by",
      filter: "choice",
      uuidValues: true,
      sortable: false,
      exportField: "changed_by_name",
    },
  ];
}

export const SYSTEM_OPTION: ChoiceOption = { value: BLANK, label: "System" };
