import { requireRole } from "@/lib/auth";
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
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <h1 className="mb-1 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
        Master Data
      </h1>
      <p className="mb-8 text-sm text-zinc-600 dark:text-zinc-400">
        Manage assets, locations, organisations, regions and gradings.
      </p>
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
