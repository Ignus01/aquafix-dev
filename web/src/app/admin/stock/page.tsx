import { requireRole } from "@/lib/auth";
import { withChanged } from "@/lib/grid/changed";
import { PageHeader } from "../page-header";
import { listLocations, listOrganisations } from "../masterdata/actions";
import { getAppTimeZone } from "../services/actions";
import {
  listPackTypes,
  listProducts,
  listProductTypes,
  listStorageAreas,
  listItemOptions,
  listMinLevels,
  listTechnicians,
  listUnitsOfMeasure,
} from "./actions";
import { StockTabs } from "./stock-tabs";

export default async function StockPage(props: PageProps<"/admin/stock">) {
  const roles = await requireRole(["system_admin", "admin", "user", "viewer"]);
  const { tab } = await props.searchParams;

  const [[products, packTypes, productTypes, storageAreas, unitsOfMeasure, minLevels], locations, organisations, timeZone, technicians, itemOptions] =
    await Promise.all([
      Promise.all([listProducts(), listPackTypes(), listProductTypes(), listStorageAreas(), listUnitsOfMeasure(), listMinLevels()]).then(
        (lists) => withChanged(...lists),
      ),
      listLocations(),
      listOrganisations(),
      getAppTimeZone(),
      listTechnicians(),
      listItemOptions(),
    ]);

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader breadcrumb="Setup / Stock Master Files" title="Stock Master Files" />
      <StockTabs
        roles={roles}
        products={products}
        packTypes={packTypes}
        productTypes={productTypes}
        storageAreas={storageAreas}
        unitsOfMeasure={unitsOfMeasure}
        locations={locations}
        organisations={organisations}
        technicians={technicians}
        minLevels={minLevels}
        itemOptions={itemOptions}
        timeZone={timeZone}
        initialTab={typeof tab === "string" ? tab : undefined}
      />
    </div>
  );
}
