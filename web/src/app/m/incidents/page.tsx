import { getCurrentUser, getCurrentUserRoles } from "@/lib/auth";
import { isIncidentAdmin, isIncidentWriter } from "@/lib/incidents/permissions";
import { getAppTimeZone, listIncidents } from "../../admin/incidents/actions";
import { Header } from "../ui";
import { IncidentList } from "./incident-list";

export const metadata = { title: "Incidents · AquaFix" };

// Incident_Overview_PWA: my incidents that are still open, plus anything
// logged today (the toggle shows everyone's).
export default async function IncidentsPage() {
  const [incidents, timeZone, user, roles] = await Promise.all([
    listIncidents(),
    getAppTimeZone(),
    getCurrentUser(),
    getCurrentUserRoles(),
  ]);
  return (
    <>
      <Header title="Incidents" backHref="/m" />
      <IncidentList
        incidents={incidents}
        timeZone={timeZone}
        userId={user?.id ?? null}
        canCreate={isIncidentWriter(roles)}
        mineByDefault={!isIncidentAdmin(roles) && isIncidentWriter(roles)}
      />
    </>
  );
}
