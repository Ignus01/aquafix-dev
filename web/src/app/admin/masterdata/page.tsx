import { requireRole } from "@/lib/auth";
import { withChanged } from "@/lib/grid/changed";
import { PageHeader } from "../page-header";
import {
  listRegions,
  listOrganisations,
  listAssetTypes,
  listLocations,
  listColourContainers,
  listGradings,
  listAssets,
} from "./actions";
import { listInspections } from "../inspection-setup/actions";
import { getAppTimeZone } from "../services/actions";
import { MasterdataTabs, type TabKey } from "./tabs-client";

const TAB_KEYS: TabKey[] = ["asset", "asset_type", "location", "organisation", "region", "grading"];

export default async function MasterdataPage(props: PageProps<"/admin/masterdata">) {
  const roles = await requireRole(["system_admin", "admin", "user", "viewer"]);
  const { tab: tabParam } = await props.searchParams;
  const initialTab = TAB_KEYS.find((t) => t === tabParam);

  const [lists, inspections, timeZone] = await Promise.all([
    Promise.all([
      listRegions(),
      listOrganisations(),
      listAssetTypes(),
      listLocations(),
      listColourContainers(),
      listGradings(),
      listAssets(),
    ]).then((l) => withChanged(...l)),
    listInspections(),
    getAppTimeZone(),
  ]);
  const [regions, organisations, assetTypes, locations, colourContainers, gradings, assets] = lists;

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader breadcrumb="Setup / Master Files" title="Master Files" />
      <MasterdataTabs
        roles={roles}
        regions={regions}
        organisations={organisations}
        assetTypes={assetTypes}
        locations={locations}
        colourContainers={colourContainers}
        gradings={gradings}
        assets={assets}
        inspections={inspections}
        initialTab={initialTab}
        timeZone={timeZone}
      />
    </div>
  );
}
