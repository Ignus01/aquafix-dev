import { getAppTimeZone, listMyActivitiesToday } from "../../admin/inspections/actions";
import { Header } from "../ui";
import { InspectionOverview } from "./overview";

export const metadata = { title: "Inspections · AquaFix" };

// Inspection_Overview_PWA: my inspections from today.
export default async function InspectionsPage() {
  const [activities, timeZone] = await Promise.all([listMyActivitiesToday(), getAppTimeZone()]);
  return (
    <>
      <Header title="Inspection Overview" backHref="/m" />
      <InspectionOverview activities={activities} timeZone={timeZone} />
    </>
  );
}
