import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { selectAll } from "@/lib/supabase/select-all";
import type { SiteQuality } from "./types";

type Scope = {
  p_from: string;
  p_to: string;
  p_region_id: string | null;
  p_organisation_id: string | null;
  p_location_id: string | null;
};

// Each site's latest lab sample sampled in the period, by location id, for
// the Water usage matrices. Out of spec is judged against the parameters'
// current limits (public.lab_sample_overview). Null when lab results can't be
// read, so the dashboard still loads without them.
export async function latestSampleBySite(
  supabase: Awaited<ReturnType<typeof createClient>>,
  scope: Scope,
): Promise<Record<string, SiteQuality> | null> {
  try {
    const rows = (await selectAll(() => {
      let q = supabase
        .from("lab_sample_overview")
        .select("id, location_id, lab_no, sampled_on, out_of_spec, inconclusive, out_of_spec_names")
        .gte("sampled_on", scope.p_from)
        .lte("sampled_on", scope.p_to);
      if (scope.p_region_id) q = q.eq("region_id", scope.p_region_id);
      if (scope.p_organisation_id) q = q.eq("organisation_id", scope.p_organisation_id);
      if (scope.p_location_id) q = q.eq("location_id", scope.p_location_id);
      return q.order("sampled_on", { ascending: false }).order("lab_no", { ascending: false }).order("id");
    })) as unknown as {
      id: string;
      location_id: string;
      lab_no: string;
      sampled_on: string;
      out_of_spec: number;
      inconclusive: number;
      out_of_spec_names: string[];
    }[];

    const bySite: Record<string, SiteQuality> = {};
    for (const r of rows) {
      const site = bySite[r.location_id];
      if (site) {
        site.samples++;
        continue;
      }
      bySite[r.location_id] = {
        sample_id: r.id,
        lab_no: r.lab_no,
        sampled_on: r.sampled_on,
        out_of_spec: r.out_of_spec,
        inconclusive: r.inconclusive,
        out_of_spec_names: r.out_of_spec_names ?? [],
        samples: 1,
      };
    }
    return bySite;
  } catch {
    return null;
  }
}
