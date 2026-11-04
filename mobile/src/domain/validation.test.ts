// The phone's validation against the golden cases the server is tested with:
// supabase/tests/inspections_test.sql (T1–T16, V8, edit) and the A5 cut-off
// from supabase/tests/offline_commands_test.sql. Same setup, same inputs,
// same expected messages, retries, gradings and display values.
import { describe, expect, it } from "vitest";
import {
  activityGrading,
  autoIncidentComment,
  displayValue,
  formatInspectionNumber,
  type FeedbackDef,
  type FormValue,
  type GradingDef,
  type InspectionDef,
  type OptionDef,
  type RuleDef,
  type StoredValue,
  validateActivity,
  valueGrading,
} from "./validation";

// ---- Setup (validation §8 "Common setup") ----------------------------------
const GOOD = "20000000-0000-0000-7e57-000000000001";
const FAIR = "20000000-0000-0000-7e57-000000000002";
const POOR = "20000000-0000-0000-7e57-000000000003";
const gradings = new Map<string, GradingDef>([
  [GOOD, { id: GOOD, priority: 1, legacy_uid: 1 }],
  [FAIR, { id: FAIR, priority: 2, legacy_uid: 2 }],
  [POOR, { id: POOR, priority: 3, legacy_uid: 3 }],
]);

const CHLORINE = "40000000-0000-0000-7e57-000000000001";
const METER = "40000000-0000-0000-7e57-000000000002";
const METER2 = "40000000-0000-0000-7e57-000000000003";
const PUMP_STATE = "40000000-0000-0000-7e57-000000000004";
const NOTES = "40000000-0000-0000-7e57-000000000005";

const inspections = new Map<string, InspectionDef>([
  [CHLORINE, { id: CHLORINE, name: "Chlorine", value_type: "DECIMAL_VALUE", is_required: true, nr_of_images_required: 0 }],
  [METER, { id: METER, name: "Meter", value_type: "CUMULATIVE_VALUE", is_required: true, nr_of_images_required: 0 }],
  [METER2, { id: METER2, name: "Meter2", value_type: "CUMULATIVE_VALUE", is_required: false, nr_of_images_required: 0 }],
  [PUMP_STATE, { id: PUMP_STATE, name: "Pump state", value_type: "DROP_DOWN", is_required: true, nr_of_images_required: 1 }],
  [NOTES, { id: NOTES, name: "Notes", value_type: "TEXT", is_required: true, nr_of_images_required: 0 }],
]);

// Rules in creation order R1, R2, R3.
const R1 = "50000000-0000-0000-7e57-000000000001";
const rules: RuleDef[] = [
  { id: R1, legacy_uid: 1, inspection_id: CHLORINE, lower_limit: 0, upper_limit: 1, nr_of_images_required: 2, grading_id: POOR },
  { id: "R2", legacy_uid: 2, inspection_id: CHLORINE, lower_limit: 1, upper_limit: 3, nr_of_images_required: 0, grading_id: GOOD },
  { id: "R3", legacy_uid: 3, inspection_id: CHLORINE, lower_limit: 3, upper_limit: 5, nr_of_images_required: 1, grading_id: FAIR },
];
const WATER_QUALITY = "60000000-0000-0000-7e57-000000000001";
const feedback: FeedbackDef[] = [
  { id: "F1", inspection_rule_id: R1, feedback: "Re-test the sample", max_nr_of_retries: 1, auto_create_incident: true, incident_type_id: WATER_QUALITY },
];
const FAIL = "70000000-0000-0000-7e57-000000000001";
const options = new Map<string, OptionDef>([[FAIL, { id: FAIL, inspection_id: PUMP_STATE, name: "Fail", grading_id: POOR }]]);

// inspection_cumulative_value: Meter and Meter2 on Pump 1 at 100.
const store = new Map([
  [METER, 100],
  [METER2, 100],
]);

const chlorine = (id: string, value: number, current = true, images = 0): FormValue => ({
  id,
  inspection_id: CHLORINE,
  is_current: current,
  text_value: "",
  decimal_value: value,
  date_value: null,
  drop_down_option_id: null,
  image_count: images,
});
const meter = (id: string, inspection: string, value: number): FormValue => ({ ...chlorine(id, value), inspection_id: inspection });
const pump = (id: string, images: number): FormValue => ({
  ...chlorine(id, 0, true, images),
  inspection_id: PUMP_STATE,
  drop_down_option_id: FAIL,
});
const text = (id: string, value: string): FormValue => ({ ...chlorine(id, 0), inspection_id: NOTES, text_value: value });

let n = 0;
function save(values: FormValue[], stored = new Map<string, StoredValue>(), previous?: (id: string) => number) {
  return validateActivity({
    values,
    inspections,
    rules,
    feedback,
    stored,
    previousCumulative: previous ?? ((id) => store.get(id) ?? 0),
    newId: () => `new-${++n}`,
  });
}
const messages = (r: ReturnType<typeof save>) => (r.ok ? [] : r.messages.map((m) => m.message));
const grading = (v: FormValue) => valueGrading(v, inspections.get(v.inspection_id)!, options, rules);

// ---- T1–T4: rule matching and grading-driven photos ------------------------
describe("T1–T4 rule matching and grading-driven photos", () => {
  it("T1: 2.0 is valid, graded Good, display 2", () => {
    const v = chlorine("v1", 2.0);
    expect(save([v]).ok).toBe(true);
    expect(grading(v)).toBe(GOOD);
    expect(activityGrading([grading(v)], gradings)).toBe(GOOD);
    expect(displayValue(v, "DECIMAL_VALUE", options, "Africa/Johannesburg")).toBe("2");
  });

  it("T2: 3.0 without a photo is invalid (D1)", () => {
    const r = save([chlorine("v2", 3.0)]);
    expect(r.ok).toBe(false);
    expect(messages(r)).toEqual(["Chlorine Image Required due to Grading!\n0 were taken but 1 are required."]);
  });

  it("T3: 3.0 with a photo is valid and matches R3 (upper bound exclusive)", () => {
    const v = chlorine("v3", 3.0, true, 1);
    expect(save([v]).ok).toBe(true);
    expect(grading(v)).toBe(FAIR);
  });

  it("T4: 5.0 matches no rule, no grading", () => {
    const v = chlorine("v4", 5.0);
    expect(save([v]).ok).toBe(true);
    expect(grading(v)).toBeNull();
    expect(activityGrading([grading(v)], gradings)).toBeNull();
  });
});

// ---- T5–T8: Feedback retries -------------------------------------------------
describe("T5–T8 feedback retries", () => {
  it("T5: first 0.5 is rejected with the feedback text and one retry", () => {
    const r = save([chlorine("v5", 0.5)]);
    expect(r.ok).toBe(false);
    expect(messages(r)).toEqual(["Re-test the sample"]);
    if (r.ok) return;
    expect(r.retries).toHaveLength(1);
    expect(r.retries[0].superseded_id).toBe("v5");
    expect(r.retries[0].inspection_id).toBe(CHLORINE);
    expect(r.autoIncidents).toHaveLength(0);
  });

  it("T6: the superseded row needs R1 photos; the incident is triggered", () => {
    const r = save([chlorine("v5", 0.5, false), chlorine("v6", 0.6)]);
    expect(r.ok).toBe(false);
    expect(messages(r)).toEqual(["Chlorine Image Required due to Grading!\n0 were taken but 2 are required."]);
    expect(r.autoIncidents).toEqual([{ inspection_id: CHLORINE, value_id: "v6", incident_type_id: WATER_QUALITY, decimal_value: 0.6 }]);
    expect(autoIncidentComment("Pump 1", "Chlorine", 0.6)).toBe("Auto Created Incident: Pump 1 Chlorine is 0.6");
  });

  it("T7: valid with photos on row 1, graded Poor", () => {
    const vs = [chlorine("v5", 0.5, false, 2), chlorine("v6", 0.6)];
    const r = save(vs);
    expect(r.ok).toBe(true);
    expect(r.autoIncidents).toHaveLength(1);
    expect(activityGrading(vs.map(grading), gradings)).toBe(POOR);
  });

  it("T8: superseded 0.5 still needs 2 photos; then row 1 Poor, row 2 Good, activity Poor", () => {
    expect(messages(save([chlorine("v8", 0.5, false), chlorine("v9", 2.0)]))).toEqual([
      "Chlorine Image Required due to Grading!\n0 were taken but 2 are required.",
    ]);
    const vs = [chlorine("v8", 0.5, false, 2), chlorine("v9", 2.0)];
    const r = save(vs);
    expect(r.ok).toBe(true);
    expect(r.autoIncidents).toHaveLength(0);
    expect(vs.map(grading)).toEqual([POOR, GOOD]);
    expect(activityGrading(vs.map(grading), gradings)).toBe(POOR);
  });

  it("V8: a superseded value with no rule needs no photos", () => {
    expect(save([chlorine("v10", 7, false), chlorine("v11", 2.0)]).ok).toBe(true);
  });
});

// ---- T9–T11: cumulative readings --------------------------------------------
describe("T9–T11 cumulative readings", () => {
  it("T9: 99 < 100 is invalid, field message on the reading", () => {
    const r = save([meter("v20", METER, 99)]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.messages[0]).toEqual({
      kind: "field",
      value_id: "v20",
      field: "decimal_value",
      message: "Must be >= to previous value of 100",
    });
  });

  it("T10: equal is allowed", () => {
    expect(save([meter("v21", METER, 100)]).ok).toBe(true);
  });

  it("T11: not required, a decrease is accepted [AS-IS]", () => {
    expect(save([meter("v22", METER2, 50)]).ok).toBe(true);
  });

  it("A5 offline: compares with the reading captured before this one", () => {
    // The store holds a later, higher reading (500) from another inspector;
    // the earlier reading captured before this save was 100.
    const r = save([meter("v23", METER, 150)], new Map(), () => 100);
    expect(r.ok).toBe(true);
  });

  it("A5 message prints the previous value without trailing zeros", () => {
    const r = save([meter("v24", METER, 1)], new Map(), () => 12.5);
    expect(messages(r)).toEqual(["Must be >= to previous value of 12.5"]);
  });
});

// ---- T12–T16: drop-down, text, several failures ------------------------------
describe("T12–T16 drop-down, text, several failures", () => {
  it("T12: B1 only, D1 skipped", () => {
    expect(messages(save([pump("v30", 0)]))).toEqual(["Pump state Image Required.\n0 were taken but 1 are required."]);
  });

  it("T13: valid with a photo, graded Poor, display Fail", () => {
    const v = pump("v31", 1);
    expect(save([v]).ok).toBe(true);
    expect(grading(v)).toBe(POOR);
    expect(displayValue(v, "DROP_DOWN", options, "Africa/Johannesburg")).toBe("Fail");
  });

  it("T14: Required on the text (V1)", () => {
    const r = save([text("v40", "")]);
    if (r.ok) throw new Error("expected invalid");
    expect(r.messages[0]).toEqual({ kind: "field", value_id: "v40", field: "text_value", message: "Required" });
  });

  it("T16: both values report in one save", () => {
    const r = save([text("v41", ""), meter("v42", METER, 1)]);
    expect(r.ok ? 0 : r.messages.length).toBe(2);
  });

  it("A text-only activity has no grading", () => {
    const v = text("v43", "All fine");
    expect(save([v]).ok).toBe(true);
    expect(activityGrading([grading(v)], gradings)).toBeNull();
  });

  it("A1/A2: a required drop-down or date-time with no answer", () => {
    const date: InspectionDef = { id: "D", name: "When", value_type: "DATETIME", is_required: true, nr_of_images_required: 0 };
    const r = validateActivity({
      values: [{ ...pump("v50", 1), drop_down_option_id: null }, { ...chlorine("v51", 0), inspection_id: "D" }],
      inspections: new Map([...inspections, ["D", date]]),
      rules,
      feedback,
      stored: new Map(),
      previousCumulative: () => 0,
      newId: () => "x",
    });
    if (r.ok) throw new Error("expected invalid");
    expect(r.messages.map((m) => m.field)).toEqual(["drop_down_option_id", "date_value"]);
  });
});

// ---- Edit (IAC-R06) -------------------------------------------------------------
describe("Edit", () => {
  it("an existing superseded value stays superseded and keeps its reading", () => {
    const stored = new Map<string, StoredValue>([
      ["v5", { id: "v5", inspection_id: CHLORINE, is_current: false, decimal_value: 0.5 }],
      ["v6", { id: "v6", inspection_id: CHLORINE, is_current: true, decimal_value: 0.6 }],
    ]);
    const r = save([chlorine("v5", 9, true, 2), chlorine("v6", 2.0)], stored);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.values[0]).toMatchObject({ is_current: false, decimal_value: 0.5 });
  });
});

describe("formatting", () => {
  it("trims trailing zeros like trim_scale", () => {
    expect(formatInspectionNumber(2)).toBe("2");
    expect(formatInspectionNumber(1.5)).toBe("1.5");
    expect(formatInspectionNumber(15320)).toBe("15320");
    expect(formatInspectionNumber(-0)).toBe("0");
  });

  it("rounds decimal display values to 2 places", () => {
    expect(displayValue({ ...chlorine("x", 1.005) }, "DECIMAL_VALUE", options, "UTC")).toBe("1.01");
    expect(displayValue({ ...chlorine("x", 2.499) }, "CUMULATIVE_VALUE", options, "UTC")).toBe("2.5");
  });

  it("shows date-times as DD Mon YYYY, HH24:MI in the app time zone", () => {
    const v = { ...chlorine("x", 0), date_value: "2026-11-04T06:02:31.000Z" };
    expect(displayValue(v, "DATETIME", options, "Africa/Johannesburg")).toBe("04 Nov 2026, 08:02");
  });
});
