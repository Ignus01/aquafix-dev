import { requireRole } from "@/lib/auth";
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
import { MasterdataTabs } from "./tabs-client";

export default async function MasterdataPage() {
  const roles = await requireRole(["system_admin", "admin", "user", "viewer"]);

  const [
    regions,
    organisations,
    assetTypes,
    locations,
    colourContainers,
    gradings,
    assets,
  ] = await Promise.all([
    listRegions(),
    listOrganisations(),
    listAssetTypes(),
    listLocations(),
    listColourContainers(),
    listGradings(),
    listAssets(),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader breadcrumb="Master Data / Masterfiles" title="Masterfiles" />
      <MasterdataTabs
        roles={roles}
        regions={regions}
        organisations={organisations}
        assetTypes={assetTypes}
        locations={locations}
        colourContainers={colourContainers}
        gradings={gradings}
        assets={assets}
      />
    </div>
  );
}
