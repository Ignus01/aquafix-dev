import { listInspectionLocations } from "../../../admin/inspections/actions";
import { Header } from "../../ui";
import { LocationPicker } from "./location-picker";

export const metadata = { title: "New inspection · AquaFix" };

// Inspection_SelectLocation.
export default async function NewInspectionPage(props: PageProps<"/m/inspections/new">) {
  const { instruction } = await props.searchParams;
  const locations = await listInspectionLocations();
  return (
    <>
      <Header title="New Inspection" backHref="/m/inspections" />
      <LocationPicker locations={locations} instruction={typeof instruction === "string" ? instruction : null} />
    </>
  );
}
