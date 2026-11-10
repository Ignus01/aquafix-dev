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
  listUnitsOfMeasure,
} from "./actions";
import { StockTabs } from "./stock-tabs";

export default async function StockPage(props: PageProps<"/admin/stock">) {
  const roles = await requireRole(["system_admin", "admin", "user", "viewer"]);
  const { tab } = await props.searchParams;

  const [[products, packTypes, productTypes, storageAreas, unitsOfMeasure], locations, organisations, timeZone] =
    await Promise.all([
      Promise.all([listProducts(), listPackTypes(), listProductTypes(), listStorageAreas(), listUnitsOfMeasure()]).then(
        (lists) => withChanged(...lists),
      ),
      listLocations(),
      listOrganisations(),
      getAppTimeZone(),
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
        timeZone={timeZone}
        initialTab={typeof tab === "string" ? tab : undefined}
      />
    </div>
  );
}
