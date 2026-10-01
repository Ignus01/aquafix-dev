import { notFound } from "next/navigation";
import { getAppTimeZone, listLocationAssets } from "../../../../admin/inspections/actions";
import { Header } from "../../../ui";
import { AssetPicker } from "./asset-picker";

export const metadata = { title: "Select asset · AquaFix" };

// Inspection_SelectAsset.
export default async function SelectAssetPage(props: PageProps<"/m/inspections/new/[locationId]">) {
  const { locationId } = await props.params;
  const { instruction } = await props.searchParams;
  const [{ location, assets }, timeZone] = await Promise.all([listLocationAssets(locationId), getAppTimeZone()]);
  if (!location) notFound();
  return (
    <>
      <Header title="New Inspection" backHref="/m/inspections/new" />
      <AssetPicker
        location={location}
        assets={assets}
        timeZone={timeZone}
        instruction={typeof instruction === "string" ? instruction : null}
      />
    </>
  );
}
