import { requireRole } from "@/lib/auth";
import { INCIDENT_WRITERS } from "@/lib/incidents/permissions";
import { PageHeader } from "../../page-header";
import { listIncidentFormOptions } from "../actions";
import { IncidentForm } from "../incident-form";

// ACT_Incident_AddNew → Incident_NewEdit (ICD-R05: the status starts as New
// and the incident date is the moment it's saved).
export default async function NewIncidentPage() {
  await requireRole(INCIDENT_WRITERS);
  const { types, locations } = await listIncidentFormOptions();

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader breadcrumb="Operations / Incidents" title="New incident" />
      <IncidentForm incident={null} types={types} locations={locations} />
    </div>
  );
}
