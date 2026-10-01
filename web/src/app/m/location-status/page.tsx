import { listLocationStatus } from "../../admin/incidents/actions";
import { Header } from "../ui";
import { LocationStatusList } from "./location-status-list";

export const metadata = { title: "Location Status · AquaFix" };

// LocationStatus_Overview: On while no open incident disables the location.
export default async function LocationStatusPage() {
  const locations = await listLocationStatus();
  return (
    <>
      <Header title="Location Status" backHref="/m" />
      <LocationStatusList locations={locations} />
    </>
  );
}
