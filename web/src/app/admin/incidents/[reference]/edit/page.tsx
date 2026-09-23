import { notFound, redirect } from "next/navigation";
import { getCurrentUser, requireRole } from "@/lib/auth";
import { canEditIncident, INCIDENT_WRITERS } from "@/lib/incidents/permissions";
import { PageHeader } from "../../../page-header";
import { getIncidentDetail, listIncidentFormOptions } from "../../actions";
import { IncidentForm } from "../../incident-form";

export default async function EditIncidentPage(props: PageProps<"/admin/incidents/[reference]/edit">) {
  const roles = await requireRole(INCIDENT_WRITERS);
  const { reference } = await props.params;
  const ref = Number(reference);
  if (!Number.isInteger(ref) || ref <= 0) notFound();

  const user = await getCurrentUser();

  const [incident, { types, locations }] = await Promise.all([
    getIncidentDetail(ref),
    listIncidentFormOptions(),
  ]);
  if (!incident) notFound();
  if (!canEditIncident(roles, user?.id ?? null, incident)) redirect(`/admin/incidents/${ref}`);

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader breadcrumb={`Operations / Incidents / ${ref}`} title={`Edit incident ${ref}`} />
      <IncidentForm incident={incident} types={types} locations={locations} />
    </div>
  );
}
