import { requireRole } from "@/lib/auth";
import { selectAll } from "@/lib/supabase/select-all";
import { createClient } from "@/lib/supabase/server";
import { QUALITY_READERS, isQualityAdmin } from "@/lib/quality/permissions";
import { PageHeader } from "../../page-header";
import { listLabs, listLocationMaps, listParameterMaps, listParameters } from "./actions";
import { ParametersTabs } from "./tabs-client";

// Quality → Parameters: Aquafix's parameters with their acceptable levels,
// the lab column and locality mappings saved by imports, and the labs.
export default async function ParametersPage() {
  const roles = await requireRole(QUALITY_READERS);
  const supabase = await createClient();
  const [parameters, parameterMaps, locationMaps, labs, locations] = await Promise.all([
    listParameters(),
    listParameterMaps(),
    listLocationMaps(),
    listLabs(),
    selectAll(() => supabase.from("location").select("id, name, active").order("name").order("id")),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader breadcrumb="Quality / Parameters" title="Parameters" />
      <ParametersTabs
        canEdit={isQualityAdmin(roles)}
        parameters={parameters}
        parameterMaps={parameterMaps}
        locationMaps={locationMaps}
        labs={labs}
        locations={locations as { id: string; name: string; active: boolean }[]}
      />
    </div>
  );
}
