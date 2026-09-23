import Link from "next/link";
import { getCurrentUser, requireRole } from "@/lib/auth";
import { INCIDENT_READERS, isIncidentWriter } from "@/lib/incidents/permissions";
import { PageHeader } from "../page-header";
import { PlusIcon } from "../icons";
import { getAppTimeZone, listIncidents, listLocationStatus } from "./actions";
import { IncidentsView } from "./incidents-view";

// Incident_Overview (desktop, admins) and Incident_Overview_PWA (field users)
// in one responsive page, plus LocationStatus_Overview as a second tab.
export default async function IncidentsPage() {
  const roles = await requireRole(INCIDENT_READERS);
  const user = await getCurrentUser();

  const [incidents, locations, timeZone] = await Promise.all([
    listIncidents(),
    listLocationStatus(),
    getAppTimeZone(),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumb="Operations / Incidents"
        title="Incidents"
        actions={
          isIncidentWriter(roles) && (
            <Link
              href="/admin/incidents/new"
              className="flex h-[38px] items-center gap-2 rounded-control bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
            >
              <PlusIcon className="h-4 w-4" />
              New incident
            </Link>
          )
        }
      />
      <IncidentsView
        roles={roles}
        userId={user?.id ?? null}
        incidents={incidents}
        locations={locations}
        timeZone={timeZone}
      />
    </div>
  );
}
