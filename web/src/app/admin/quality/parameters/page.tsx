import { requireRole } from "@/lib/auth";
import { withChanged } from "@/lib/grid/changed";
import { selectAll } from "@/lib/supabase/select-all";
import { createClient } from "@/lib/supabase/server";
import { QUALITY_READERS, isQualityAdmin } from "@/lib/quality/permissions";
import { PageHeader } from "../../page-header";
import { getAppTimeZone } from "../../services/actions";
import { listLabs, listLocationMaps, listParameterMaps, listParameters } from "./actions";
import { ParametersTabs } from "./tabs-client";

// Quality → Parameters: Aquafix's parameters with their acceptable levels,
// the lab column and locality mappings saved by imports, and the labs.
export default async function ParametersPage(props: PageProps<"/admin/quality/parameters">) {
  const roles = await requireRole(QUALITY_READERS);
  const { tab } = await props.searchParams;
  const supabase = await createClient();
  const [[parameters, parameterMaps, locationMaps, labs], locations, timeZone] = await Promise.all([
    Promise.all([listParameters(), listParameterMaps(), listLocationMaps(), listLabs()]).then((lists) =>
      withChanged(...lists),
    ),
    selectAll(() => supabase.from("location").select("id, name, active").order("name").order("id")),
    getAppTimeZone(),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader breadcrumb="Setup / Quality Parameters" title="Quality Parameters" />
      <ParametersTabs
        canEdit={isQualityAdmin(roles)}
        parameters={parameters}
        parameterMaps={parameterMaps}
        locationMaps={locationMaps}
        labs={labs}
        locations={locations as { id: string; name: string; active: boolean }[]}
        timeZone={timeZone}
        initialTab={typeof tab === "string" ? tab : undefined}
      />
    </div>
  );
}
