// The phone's copy of save_inspection_activity, sections A–D (validation) and
// §4/§5.1 (grading and display values). The SQL to match is the current
// function in supabase/migrations/20261104140000_offline_capture_rpcs.sql;
// the rule names (A1–D1, C1–C7) and signed-off deviations (V1–V9) below are
// the ones its comments use. The server runs the same rules again on upload
// and stays the final judge.
//
// Pure TypeScript with no React Native imports, so the unit tests in
// validation.test.ts run under Node.

import { toDate } from "./dates";

export type ValueType = "TEXT" | "DECIMAL_VALUE" | "CUMULATIVE_VALUE" | "DATETIME" | "DROP_DOWN";

export type InspectionDef = {
  id: string;
  name: string;
  value_type: ValueType;
  is_required: boolean;
  nr_of_images_required: number;
};

export type RuleDef = {
  id: string;
  legacy_uid: number | null;
  inspection_id: string;
  lower_limit: number;
  upper_limit: number;
  nr_of_images_required: number;
  grading_id: string | null;
};

export type FeedbackDef = {
  id: string;
  inspection_rule_id: string;
  feedback: string;
  max_nr_of_retries: number;
  auto_create_incident: boolean;
  incident_type_id: string | null;
};

export type OptionDef = { id: string; inspection_id: string; name: string; grading_id: string | null };

export type GradingDef = { id: string; priority: number; legacy_uid: number | null };

// One value as the form sends it (the save payload's `values[]`).
export type FormValue = {
  id: string;
  inspection_id: string;
  is_current: boolean;
  text_value: string;
  decimal_value: number;
  date_value: string | null;
  drop_down_option_id: string | null;
  image_count: number;
};

// A value already saved for this activity (edit), as the server would find it.
export type StoredValue = { id: string; inspection_id: string; is_current: boolean; decimal_value: number };

export type SaveMessage = {
  kind: "field" | "popup";
  value_id: string;
  field?: "drop_down_option_id" | "date_value" | "text_value" | "decimal_value";
  message: string;
};

export type SaveRetry = { superseded_id: string; new_id: string; inspection_id: string };

// C5: an incident the server will create when this value is accepted.
export type AutoIncident = { inspection_id: string; value_id: string; incident_type_id: string | null; decimal_value: number };

export type ValidationInput = {
  values: FormValue[];
  inspections: Map<string, InspectionDef>;
  rules: RuleDef[];
  feedback: FeedbackDef[];
  // Values already stored for the activity being edited (empty for a new one).
  stored: Map<string, StoredValue>;
  // A5: the reading to compare a cumulative value with (the highest current
  // reading of that inspection on the asset captured before this save, else
  // the cumulative store, else 0).
  previousCumulative: (inspectionId: string) => number;
  newId: () => string;
};

export type ValidationResult =
  | { ok: true; values: NormalisedValue[]; autoIncidents: AutoIncident[] }
  | { ok: false; messages: SaveMessage[]; retries: SaveRetry[]; autoIncidents: AutoIncident[] };

export type NormalisedValue = Omit<FormValue, "image_count"> & { image_count: number; value_type: ValueType };

// public.format_inspection_number: trim_scale(numeric)::text.
export function formatInspectionNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Object.is(n, -0)) return "0";
  // Postgres numerics never print in exponent form.
  const s = Math.abs(n) >= 1e21 || (Math.abs(n) < 1e-6 && n !== 0) ? n.toFixed(20) : String(n);
  if (!s.includes(".")) return s;
  return s.replace(/0+$/, "").replace(/\.$/, "");
}

// round(numeric, 2): half away from zero.
export function round2(n: number): number {
  const r = Math.round(Math.abs(n) * 100 + 1e-9) / 100;
  return n < 0 ? -r : r;
}

// The rule a decimal falls in: lower_limit <= v < upper_limit, by legacy_uid
// (nulls last, as Postgres sorts ascending), first one.
export function matchRule(rules: RuleDef[], inspectionId: string, v: number): RuleDef | null {
  const hits = rules
    .filter((r) => r.inspection_id === inspectionId && r.lower_limit <= v && v < r.upper_limit)
    .sort((a, b) => {
      if (a.legacy_uid === b.legacy_uid) return 0;
      if (a.legacy_uid === null) return 1;
      if (b.legacy_uid === null) return -1;
      return a.legacy_uid - b.legacy_uid;
    });
  return hits[0] ?? null;
}

// The server normalises the payload first: a value already stored as
// superseded stays superseded and keeps its stored reading.
export function normalise(values: FormValue[], inspections: Map<string, InspectionDef>, stored: Map<string, StoredValue>): NormalisedValue[] {
  return values.map((v) => {
    const insp = inspections.get(v.inspection_id);
    if (!insp) throw new Error("An inspection on this form no longer exists — reload and try again.");
    const existing = stored.get(v.id);
    const keepSuperseded = existing !== undefined && !existing.is_current;
    return {
      ...v,
      value_type: insp.value_type,
      is_current: keepSuperseded ? false : v.is_current,
      decimal_value: keepSuperseded ? existing.decimal_value : v.decimal_value,
      text_value: v.text_value ?? "",
      date_value: v.date_value || null,
      drop_down_option_id: v.drop_down_option_id || null,
    };
  });
}

// §3 Validation. Every value is checked, even after one has failed, so all
// messages and retries come back from one Save (§3.1).
export function validateActivity(input: ValidationInput): ValidationResult {
  const { inspections, rules, feedback } = input;
  const values = normalise(input.values, inspections, input.stored);
  const messages: SaveMessage[] = [];
  const retries: SaveRetry[] = [];
  const retryCounts = new Map<string, number>();
  const autoIncidents: AutoIncident[] = [];
  let valid = true;

  for (const v of values) {
    const insp = inspections.get(v.inspection_id)!;
    let ok = true;
    const dec = v.decimal_value;
    const imageCount = v.image_count;

    // A. Answer present / monotonic — only when the inspection is required.
    if (insp.is_required) {
      if (insp.value_type === "DROP_DOWN" && v.drop_down_option_id === null) {
        ok = false; // A1
        messages.push({ kind: "field", value_id: v.id, field: "drop_down_option_id", message: "Required" });
      } else if (insp.value_type === "DATETIME" && v.date_value === null) {
        ok = false; // A2 (V1)
        messages.push({ kind: "field", value_id: v.id, field: "date_value", message: "Required" });
      } else if (insp.value_type === "TEXT" && v.text_value === "") {
        ok = false; // A3 (V1)
        messages.push({ kind: "field", value_id: v.id, field: "text_value", message: "Required" });
      } else if (insp.value_type === "CUMULATIVE_VALUE") {
        const latest = input.previousCumulative(insp.id) ?? 0;
        if (!(dec >= latest)) {
          ok = false; // A5
          messages.push({
            kind: "field",
            value_id: v.id,
            field: "decimal_value",
            message: `Must be >= to previous value of ${formatInspectionNumber(latest)}`,
          });
        }
      }
      // A4 (DECIMAL_VALUE "Required") never fires: the value defaults to 0.
    }

    // B. Inspection-level minimum images (every type, required or not).
    if (imageCount < insp.nr_of_images_required) {
      ok = false; // B1
      messages.push({
        kind: "popup",
        value_id: v.id,
        message: `${insp.name} Image Required.\n${imageCount} were taken but ${insp.nr_of_images_required} are required.`,
      });
    }

    if (ok) {
      // C. Grading-driven requirements.
      let req = 0;
      if (insp.value_type === "DROP_DOWN") {
        req = insp.nr_of_images_required; // C1 [AS-IS]
      } else if (insp.value_type === "DECIMAL_VALUE") {
        const rule = matchRule(rules, insp.id, dec);
        if (v.is_current) {
          if (rule) {
            // (C2: no rule, valid)
            const fb = feedback.find((f) => f.inspection_rule_id === rule.id) ?? null;
            if (!fb) {
              req = rule.nr_of_images_required; // C3
            } else {
              // attempts(v): every value for this inspection on the form, plus
              // retries created earlier in this same Save.
              const attempts =
                values.filter((e) => e.inspection_id === insp.id).length + (retryCounts.get(insp.id) ?? 0);
              if (attempts <= fb.max_nr_of_retries) {
                ok = false; // C4: force a retry
                retries.push({ superseded_id: v.id, new_id: input.newId(), inspection_id: insp.id });
                retryCounts.set(insp.id, (retryCounts.get(insp.id) ?? 0) + 1);
                messages.push({ kind: "popup", value_id: v.id, message: fb.feedback });
              } else if (fb.auto_create_incident) {
                // C5: accepted; the server creates the incident (no email).
                autoIncidents.push({
                  inspection_id: insp.id,
                  value_id: v.id,
                  incident_type_id: fb.incident_type_id,
                  decimal_value: dec,
                });
              }
            }
          }
        } else {
          req = rule?.nr_of_images_required ?? 0; // C6 (V8)
        }
      }
      // C7: CUMULATIVE_VALUE, DATETIME and TEXT have no grading requirements.

      // D. Grading-driven images.
      if (ok && imageCount < req) {
        ok = false; // D1
        messages.push({
          kind: "popup",
          value_id: v.id,
          message: `${insp.name} Image Required due to Grading!\n${imageCount} were taken but ${req} are required.`,
        });
      }
    }

    valid = valid && ok;
  }

  if (!valid) return { ok: false, messages, retries, autoIncidents };
  return { ok: true, values, autoIncidents };
}

// §4 Grading of one value: the chosen option's grading (drop-down) or the
// matching rule's grading (decimal). Other types: null.
export function valueGrading(
  v: { inspection_id: string; decimal_value: number; drop_down_option_id: string | null },
  insp: InspectionDef,
  options: Map<string, OptionDef>,
  rules: RuleDef[],
): string | null {
  if (insp.value_type === "DROP_DOWN") {
    return v.drop_down_option_id ? (options.get(v.drop_down_option_id)?.grading_id ?? null) : null;
  }
  if (insp.value_type === "DECIMAL_VALUE") {
    return matchRule(rules, insp.id, v.decimal_value)?.grading_id ?? null;
  }
  return null;
}

// §4 Activity grading: the value grading with the highest priority number,
// then the lowest legacy_uid. Superseded values count too [AS-IS, V7].
export function activityGrading(gradingIds: (string | null)[], gradings: Map<string, GradingDef>): string | null {
  const found = [...new Set(gradingIds.filter((g): g is string => !!g))]
    .map((id) => gradings.get(id))
    .filter((g): g is GradingDef => !!g)
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (a.legacy_uid === b.legacy_uid) return 0;
      if (a.legacy_uid === null) return 1;
      if (b.legacy_uid === null) return -1;
      return a.legacy_uid - b.legacy_uid;
    });
  return found[0]?.id ?? null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// to_char(ts at time zone tz, 'DD Mon YYYY, HH24:MI').
export function formatDisplayDateTime(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(toDate(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")} ${MONTHS[Number(get("month")) - 1]} ${get("year")}, ${get("hour")}:${get("minute")}`;
}

// §5.1 Display value, cut to 200 characters as the column is.
export function displayValue(
  v: { decimal_value: number; date_value: string | null; text_value: string; drop_down_option_id: string | null },
  valueType: ValueType,
  options: Map<string, OptionDef>,
  timeZone: string,
): string {
  let s: string;
  switch (valueType) {
    case "CUMULATIVE_VALUE":
    case "DECIMAL_VALUE":
      s = formatInspectionNumber(round2(v.decimal_value));
      break;
    case "DATETIME":
      s = v.date_value ? formatDisplayDateTime(v.date_value, timeZone) : "";
      break;
    case "DROP_DOWN":
      s = v.drop_down_option_id ? (options.get(v.drop_down_option_id)?.name ?? "") : "";
      break;
    case "TEXT":
      s = v.text_value;
      break;
  }
  return s.slice(0, 200);
}

// The comment of a C5 incident, as the server writes it.
export function autoIncidentComment(assetName: string, inspectionName: string, value: number): string {
  return `Auto Created Incident: ${assetName} ${inspectionName} is ${formatInspectionNumber(value)}`;
}
