import { isOutOfSpec, labParameterName, nameKey, resultStatus, sameUnit } from "./evaluate";
import type { Lab, LabLocationMap, LabParameterMap, QualityParameter, ResultStatus, StagedImport } from "./types";

// The Map and Preview steps of an import, worked out from the staged files,
// the saved mappings and the user's choices. commit_lab_import() applies the
// same rules when it imports.

export type ImportData = {
  imports: StagedImport[];
  labs: Lab[];
  parameters: QualityParameter[];
  parameterMaps: LabParameterMap[];
  locationMaps: LabLocationMap[];
  locations: { id: string; name: string; active: boolean }[];
  existing: { lab_id: string; lab_no: string }[];
};

export const IGNORE = "ignore";

// parameterId: a parameter id, IGNORE, or "" (not chosen yet).
export type ParamChoice = { parameterId: string; factor: string };

export type Choices = {
  // Lab key → an existing lab id to file that lab name under ("" = by name).
  labs: Record<string, string>;
  params: Record<string, ParamChoice>;
  // Locality key → a location id, IGNORE, or "".
  localities: Record<string, string>;
};

export const labKey = (name: string) => name.trim().toLowerCase();
const itemKey = (lab: string, text: string) => `${labKey(lab)}|${text.trim().toLowerCase()}`;

export type ResolvedLab = { key: string; name: string; labId: string | null; matched: Lab | null };

// Each lab name in the files: the lab the user picked, else the lab of that
// name, else a new lab (labId null).
export function resolveLabs(data: ImportData, choices: Choices): ResolvedLab[] {
  const out = new Map<string, ResolvedLab>();
  for (const imp of data.imports) {
    const key = labKey(imp.lab_name);
    if (out.has(key)) continue;
    const matched = data.labs.find((l) => labKey(l.name) === key) ?? null;
    const picked = choices.labs[key] ? (data.labs.find((l) => l.id === choices.labs[key]) ?? null) : null;
    out.set(key, { key, name: imp.lab_name.trim(), labId: picked?.id ?? matched?.id ?? null, matched });
  }
  return [...out.values()];
}

export type ParamItem = {
  key: string;
  labName: string;
  header: string;
  unit: string;
  examples: number[];
  // The saved mapping whose unit differs from this file's.
  saved: LabParameterMap | null;
  suggestion: string | null;
};

export type LocalityItem = {
  key: string;
  labName: string;
  locality: string;
  client: string | null;
  samples: number;
  suggestion: string | null;
};

function savedParam(data: ImportData, labId: string | null, header: string) {
  if (!labId) return null;
  const h = header.trim().toLowerCase();
  return data.parameterMaps.find((m) => m.lab_id === labId && m.lab_parameter.trim().toLowerCase() === h) ?? null;
}

function savedLocality(data: ImportData, labId: string | null, locality: string) {
  if (!labId) return null;
  const l = locality.trim().toLowerCase();
  return data.locationMaps.find((m) => m.lab_id === labId && m.lab_locality.trim().toLowerCase() === l) ?? null;
}

function suggestParameter(data: ImportData, header: string): string | null {
  const key = nameKey(labParameterName(header));
  const hit = data.parameters.find(
    (p) => p.active && (nameKey(p.name) === key || (p.short_name !== null && nameKey(p.short_name) === key)),
  );
  return hit?.id ?? null;
}

// A location named like the locality, or like its end ("CP-01 Kemtton" →
// Kemtton); the longest name wins.
function suggestLocation(data: ImportData, locality: string): string | null {
  const loc = locality.trim().toLowerCase();
  const hits = data.locations.filter((l) => {
    const name = l.name.trim().toLowerCase();
    return l.active && (name === loc || loc.endsWith(` ${name}`));
  });
  hits.sort((a, b) => b.name.length - a.name.length);
  return hits[0]?.id ?? null;
}

// What the Map step asks: every column and locality without a saved mapping
// (or a column whose unit changed), once across all files.
export function mappingItems(data: ImportData, labs: ResolvedLab[]) {
  const labId = new Map(labs.map((l) => [l.key, l.labId]));
  const params = new Map<string, ParamItem>();
  const localities = new Map<string, LocalityItem>();

  for (const imp of data.imports) {
    const lab = labKey(imp.lab_name);
    const id = labId.get(lab) ?? null;
    imp.parsed.columns.forEach((col, i) => {
      const key = itemKey(lab, col.header);
      const saved = savedParam(data, id, col.header);
      const needed = !saved || (saved.parameter_id !== null && !sameUnit(saved.lab_unit, col.unit));
      if (!needed) return;
      let item = params.get(key);
      if (!item) {
        item = {
          key,
          labName: imp.lab_name.trim(),
          header: col.header,
          unit: col.unit,
          examples: [],
          saved,
          suggestion: saved?.parameter_id ?? suggestParameter(data, col.header),
        };
        params.set(key, item);
      }
      for (const row of imp.parsed.rows) {
        const v = row.values[i];
        if (v !== null && v !== undefined && item.examples.length < 3 && !item.examples.includes(v)) item.examples.push(v);
      }
    });
    for (const row of imp.parsed.rows) {
      const key = itemKey(lab, row.locality);
      if (savedLocality(data, id, row.locality)) continue;
      const item = localities.get(key);
      if (item) item.samples++;
      else
        localities.set(key, {
          key,
          labName: imp.lab_name.trim(),
          locality: row.locality,
          client: imp.client_name,
          samples: 1,
          suggestion: suggestLocation(data, row.locality),
        });
    }
  }
  return { params: [...params.values()], localities: [...localities.values()] };
}

// The choices the Map step starts with: suggestions pre-selected.
export function initialChoices(items: ReturnType<typeof mappingItems>): Pick<Choices, "params" | "localities"> {
  return {
    params: Object.fromEntries(
      items.params.map((p) => [
        p.key,
        { parameterId: p.suggestion ?? "", factor: p.saved && p.saved.parameter_id ? String(p.saved.factor) : "1" },
      ]),
    ),
    localities: Object.fromEntries(items.localities.map((l) => [l.key, l.suggestion ?? ""])),
  };
}

export const parseFactor = (s: string) => {
  const n = Number(s.trim());
  return s.trim() !== "" && Number.isFinite(n) && n > 0 ? n : null;
};

// The factor box shows only when the lab's unit differs from the parameter's.
export function needsFactor(item: { unit: string }, param: QualityParameter | undefined) {
  return Boolean(param) && !sameUnit(item.unit, param!.unit);
}

type ColumnPlan = { header: string; unit: string; parameter: QualityParameter | null; factor: number };

// How each column of a file will be imported, or null where a mapping is
// still missing.
function columnPlans(data: ImportData, choices: Choices, imp: StagedImport, labId: string | null): (ColumnPlan | null)[] {
  const byId = new Map(data.parameters.map((p) => [p.id, p]));
  return imp.parsed.columns.map((col) => {
    const choice = choices.params[itemKey(imp.lab_name, col.header)];
    if (choice) {
      if (!choice.parameterId) return null;
      if (choice.parameterId === IGNORE) return { ...col, parameter: null, factor: 1 };
      const parameter = byId.get(choice.parameterId) ?? null;
      if (!parameter) return null;
      const factor = needsFactor(col, parameter) ? parseFactor(choice.factor) : 1;
      return factor === null ? null : { ...col, parameter, factor };
    }
    const saved = savedParam(data, labId, col.header);
    if (!saved) return null;
    return { ...col, parameter: saved.parameter_id ? (byId.get(saved.parameter_id) ?? null) : null, factor: saved.factor };
  });
}

// Problems that stop the Map step: two columns of one file into one parameter.
export function mappingErrors(data: ImportData, choices: Choices, labs: ResolvedLab[]): string[] {
  const labId = new Map(labs.map((l) => [l.key, l.labId]));
  const errors = new Set<string>();
  for (const imp of data.imports) {
    const plans = columnPlans(data, choices, imp, labId.get(labKey(imp.lab_name)) ?? null);
    const seen = new Map<string, string>();
    for (const p of plans) {
      if (!p?.parameter) continue;
      const first = seen.get(p.parameter.id);
      if (first) errors.add(`"${first}" and "${p.header}" both map to ${p.parameter.name}. Ignore one of them.`);
      else seen.set(p.parameter.id, p.header);
    }
  }
  return [...errors];
}

export type PreviewCell = { value: number; below: boolean; status: ResultStatus; parameter: QualityParameter };
export type PreviewRow = {
  lab_no: string;
  locality: string;
  location: { id: string; name: string; active: boolean } | null;
  sampled_on: string;
  cells: Map<string, PreviewCell>;
  outOfSpec: string[];
  state: "new" | "existing" | "replace" | "ignored" | "duplicate";
};
export type PreviewFile = { imp: StagedImport; labName: string; parameters: QualityParameter[]; rows: PreviewRow[] };

// The Preview step: each file's samples as they will be imported, coloured
// by the evaluation rules.
export function buildPreview(data: ImportData, choices: Choices, labs: ResolvedLab[], replace: boolean) {
  const labByKey = new Map(labs.map((l) => [l.key, l]));
  const locById = new Map(data.locations.map((l) => [l.id, l]));
  const existing = new Set(data.existing.map((e) => `${e.lab_id}|${e.lab_no}`));
  const seen = new Set<string>();
  const totals = { new: 0, existing: 0, replace: 0, ignored: 0, duplicate: 0 };

  const files: PreviewFile[] = data.imports.map((imp) => {
    const lab = labByKey.get(labKey(imp.lab_name))!;
    const plans = columnPlans(data, choices, imp, lab.labId);
    const parameters = [
      ...new Map(plans.flatMap((p) => (p?.parameter ? [[p.parameter.id, p.parameter] as const] : []))).values(),
    ].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

    const rows = imp.parsed.rows.map((row): PreviewRow => {
      const choice = choices.localities[itemKey(imp.lab_name, row.locality)];
      const locationId =
        choice !== undefined
          ? choice === IGNORE
            ? null
            : choice
          : (savedLocality(data, lab.labId, row.locality)?.location_id ?? null);
      const location = locationId ? (locById.get(locationId) ?? null) : null;

      const cells = new Map<string, PreviewCell>();
      const outOfSpec: string[] = [];
      plans.forEach((p, i) => {
        const raw = row.values[i];
        if (!p?.parameter || raw === null || raw === undefined) return;
        const below = raw < 0 && !p.parameter.can_be_negative;
        const value = (below ? Math.abs(raw) : raw) * p.factor;
        const status = resultStatus(value, below, p.parameter);
        cells.set(p.parameter.id, { value, below, status, parameter: p.parameter });
        if (isOutOfSpec(status)) outOfSpec.push(p.parameter.short_name ?? p.parameter.name);
      });

      const dupKey = `${lab.key}|${row.lab_no}`;
      let state: PreviewRow["state"];
      if (!location) state = "ignored";
      else if (seen.has(dupKey)) state = "duplicate";
      else if (lab.labId && existing.has(`${lab.labId}|${row.lab_no}`)) state = replace ? "replace" : "existing";
      else state = "new";
      if (location) seen.add(dupKey);
      totals[state]++;
      return { lab_no: row.lab_no, locality: row.locality, location, sampled_on: row.sampled_on, cells, outOfSpec, state };
    });
    return { imp, labName: data.labs.find((l) => l.id === lab.labId)?.name ?? lab.name, parameters, rows };
  });
  return { files, totals };
}
