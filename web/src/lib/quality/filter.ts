import { addDays, isYmd } from "@/lib/dashboard/format";
import { PERIOD_PRESETS, type PeriodPreset } from "@/lib/dashboard/types";
import type { QualityFilter } from "./types";

// The Lab Results filters, kept in the URL: period (on the sampled date,
// default the last 90 days), region, organisation, location, lab and
// "only out of spec".

type Params = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const uuid = (v: unknown) => (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : "");

export function parseQualityFilter(params: Params, today: string): QualityFilter {
  const raw = one(params.period) ?? "90d";
  const period = (PERIOD_PRESETS.find((p) => p.key === raw)?.key ?? "90d") as PeriodPreset;
  let from = addDays(today, -89);
  let to = today;
  if (period === "30d") from = addDays(today, -29);
  else if (period === "ytd") from = `${today.slice(0, 4)}-01-01`;
  else if (period === "12m") from = addDays(today, -364);
  else if (period === "custom") {
    const f = one(params.from);
    const t = one(params.to);
    from = isYmd(f) ? f : from;
    to = isYmd(t) ? t : to;
    if (from > to) [from, to] = [to, from];
  }
  return {
    period,
    from,
    to,
    region: uuid(one(params.region)),
    organisation: uuid(one(params.organisation)),
    location: uuid(one(params.location)),
    lab: uuid(one(params.lab)),
    outOfSpec: one(params.oos) === "1",
  };
}

// The filter as URL parameters (defaults left out).
export function filterParams(f: QualityFilter): URLSearchParams {
  const p = new URLSearchParams();
  if (f.period !== "90d") p.set("period", f.period);
  if (f.period === "custom") {
    p.set("from", f.from);
    p.set("to", f.to);
  }
  if (f.region) p.set("region", f.region);
  if (f.organisation) p.set("organisation", f.organisation);
  if (f.location) p.set("location", f.location);
  if (f.lab) p.set("lab", f.lab);
  if (f.outOfSpec) p.set("oos", "1");
  return p;
}

// Import ids from `?imports=a,b` (the link after an import).
export function parseImportIds(params: Params): string[] {
  return (one(params.imports) ?? "").split(",").map(uuid).filter(Boolean).slice(0, 50);
}
