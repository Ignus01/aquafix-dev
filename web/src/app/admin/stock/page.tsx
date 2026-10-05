import { requireRole } from "@/lib/auth";
import { PageHeader } from "../page-header";
import { listLocations, listOrganisations } from "../masterdata/actions";
import {
  listPackTypes,
  listProducts,
  listProductTypes,
  listStorageAreas,
  listUnitsOfMeasure,
} from "./actions";
import { StockTabs } from "./stock-tabs";

export default async function StockPage() {
  const roles = await requireRole(["system_admin", "admin", "user", "viewer"]);

  const [products, packTypes, productTypes, storageAreas, unitsOfMeasure, locations, organisations] =
    await Promise.all([
      listProducts(),
      listPackTypes(),
      listProductTypes(),
      listStorageAreas(),
      listUnitsOfMeasure(),
      listLocations(),
      listOrganisations(),
    ]);

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader breadcrumb="Master Data / Stock Master Files" title="Stock Master Files" />
      <StockTabs
        roles={roles}
        products={products}
        packTypes={packTypes}
        productTypes={productTypes}
        storageAreas={storageAreas}
        unitsOfMeasure={unitsOfMeasure}
        locations={locations}
        organisations={organisations}
      />
    </div>
  );
}
