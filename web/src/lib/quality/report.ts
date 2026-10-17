import type { ResultStatus } from "./types";

// The home page's Quality tab: lab results and on-site inspection readings
// (public.water_quality_reading) summed up for one period and scope.

// Marker colours for the two sources.
export const SITE_COLOUR = "#0a7f9e";
export const LAB_COLOUR = "#eb6834";

export type QualityReading = {
  source: "lab" | "site";
  id: string;
  location_id: string;
  location_name: string;
  asset_name: string | null;
  sampled_on: string;
  sampled_at: string | null;
  // The lab no, or the inspection activity's UID.
  reference: string;
  sample_id: string | null;
  inspection_activity_id: string | null;
  parameter_id: string;
  parameter_name: string;
  parameter_short_name: string | null;
  unit: string;
  min_acceptable: number | null;
  max_acceptable: number | null;
  decimals: number;
  sort_order: number;
  value: number;
  below_detection: boolean;
  status: ResultStatus;
};

export type ReportParameter = {
  id: string;
  name: string;
  short_name: string | null;
  unit: string;
  min_acceptable: number | null;
  max_acceptable: number | null;
  decimals: number;
  sort_order: number;
  lab: number;
  site: number;
};

export type MatrixCell = { lab?: QualityReading; site?: QualityReading };

export type QualityReport = {
  totals: {
    readings: number;
    with_limit: number;
    out_of_spec: number;
    lab_samples: number;
    lab_results: number;
    lab_out_of_spec: number;
    site_inspections: number;
    site_readings: number;
    site_out_of_spec: number;
    sites: number;
    sites_with_both: number;
  };
  // Measured on site first, then lab only; each in the Parameters page order.
  parameters: ReportParameter[];
  locations: { id: string; name: string }[];
  // location id → parameter id → the latest lab and site reading.
  matrix: Record<string, Record<string, MatrixCell>>;
  // Out of spec, newest first.
  exceedances: QualityReading[];
  trend: {
    location_id: string;
    parameter: ReportParameter;
    // The parameters measured at the trend's site, for its picker.
    parameters: ReportParameter[];
    points: QualityReading[];
  } | null;
};

const isOut = (s: ResultStatus) => s === "high" || s === "low";

// Site readings carry a time; lab samples only a day (taken as midday).
export const readingTime = (r: Pick<QualityReading, "sampled_on" | "sampled_at">) =>
  r.sampled_at ? Date.parse(r.sampled_at) : Date.parse(`${r.sampled_on}T12:00:00Z`);

// Adds a reading to its parameter's lab / site count.
function countParameter(params: Map<string, ReportParameter>, r: QualityReading) {
  let p = params.get(r.parameter_id);
  if (!p) {
    p = {
      id: r.parameter_id,
      name: r.parameter_name,
      short_name: r.parameter_short_name,
      unit: r.unit,
      min_acceptable: r.min_acceptable,
      max_acceptable: r.max_acceptable,
      decimals: r.decimals,
      sort_order: r.sort_order,
      lab: 0,
      site: 0,
    };
    params.set(r.parameter_id, p);
  }
  p[r.source]++;
}

const byParameterOrder =(a: ReportParameter, b: ReportParameter) =>
  a.sort_order - b.sort_order || a.name.localeCompare(b.name);

// Measured on site first, then lab only.
const siteFirst = (a: ReportParameter, b: ReportParameter) =>
  Number(b.site > 0) - Number(a.site > 0) || byParameterOrder(a, b);

// `pick` chooses the trend: the requested site and parameter when they have
// readings, else the site with the most site readings and, there, the
// parameter measured both on site and by the lab most often.
export function buildQualityReport(
  rows: QualityReading[],
  pick: { location?: string; parameter?: string } = {},
  exceedanceLimit = 12,
): QualityReport {
  const params = new Map<string, ReportParameter>();
  const locations = new Map<string, string>();
  const matrix: QualityReport["matrix"] = {};
  const labSamples = new Set<string>();
  const siteInspections = new Set<string>();
  const t = {
    readings: rows.length,
    with_limit: 0,
    out_of_spec: 0,
    lab_samples: 0,
    lab_results: 0,
    lab_out_of_spec: 0,
    site_inspections: 0,
    site_readings: 0,
    site_out_of_spec: 0,
    sites: 0,
    sites_with_both: 0,
  };

  for (const r of rows) {
    locations.set(r.location_id, r.location_name);
    countParameter(params, r);

    if (r.status !== "no_limit") t.with_limit++;
    const out = isOut(r.status);
    if (out) t.out_of_spec++;
    if (r.source === "lab") {
      t.lab_results++;
      if (out) t.lab_out_of_spec++;
      if (r.sample_id) labSamples.add(r.sample_id);
    } else {
      t.site_readings++;
      if (out) t.site_out_of_spec++;
      if (r.inspection_activity_id) siteInspections.add(r.inspection_activity_id);
    }

    const cell = ((matrix[r.location_id] ??= {})[r.parameter_id] ??= {});
    const latest = cell[r.source];
    if (!latest || readingTime(r) > readingTime(latest)) cell[r.source] = r;
  }

  t.lab_samples = labSamples.size;
  t.site_inspections = siteInspections.size;
  t.sites = locations.size;
  t.sites_with_both = Object.values(matrix).filter((cells) => {
    const all = Object.values(cells);
    return all.some((c) => c.lab) && all.some((c) => c.site);
  }).length;

  const parameters = [...params.values()].sort(siteFirst);
  const locationList = [...locations]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const exceedances = rows
    .filter((r) => isOut(r.status))
    .sort((a, b) => readingTime(b) - readingTime(a))
    .slice(0, exceedanceLimit);

  return {
    totals: t,
    parameters,
    locations: locationList,
    matrix,
    exceedances,
    trend: pickTrend(rows, pick),
  };
}

function pickTrend(rows: QualityReading[], pick: { location?: string; parameter?: string }): QualityReport["trend"] {
  if (rows.length === 0) return null;

  const perSite = new Map<string, { site: number; all: number }>();
  for (const r of rows) {
    const c = perSite.get(r.location_id) ?? { site: 0, all: 0 };
    c.all++;
    if (r.source === "site") c.site++;
    perSite.set(r.location_id, c);
  }
  const locationId =
    pick.location && perSite.has(pick.location)
      ? pick.location
      : [...perSite].sort((a, b) => b[1].site - a[1].site || b[1].all - a[1].all)[0][0];

  const atSite = rows.filter((r) => r.location_id === locationId);
  const params = new Map<string, ReportParameter>();
  for (const r of atSite) countParameter(params, r);
  const parameters = [...params.values()].sort(siteFirst);
  const parameter =
    (pick.parameter && params.get(pick.parameter)) ||
    [...parameters].sort(
      (a, b) =>
        Number(b.site > 0 && b.lab > 0) - Number(a.site > 0 && a.lab > 0) ||
        b.site - a.site ||
        b.lab - a.lab ||
        byParameterOrder(a, b),
    )[0];

  return {
    location_id: locationId,
    parameter,
    parameters,
    points: atSite
      .filter((r) => r.parameter_id === parameter.id)
      .sort((a, b) => readingTime(a) - readingTime(b)),
  };
}
