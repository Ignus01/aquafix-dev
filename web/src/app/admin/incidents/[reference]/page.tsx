import { notFound } from "next/navigation";
import { getCurrentUser, requireRole } from "@/lib/auth";
import { INCIDENT_READERS } from "@/lib/incidents/permissions";
import { getAppTimeZone, getIncidentDetail } from "../actions";
import { IncidentReport } from "./incident-report";

// Incident_View ("INCIDENT REPORT {_UID}") — the target of the email link.
// Open to every role, so every subscriber can follow the link (EML-R08).
export default async function IncidentPage(props: PageProps<"/admin/incidents/[reference]">) {
  const roles = await requireRole(INCIDENT_READERS);
  const { reference } = await props.params;
  const ref = Number(reference);
  if (!Number.isInteger(ref) || ref <= 0) notFound();

  const [user, incident, timeZone] = await Promise.all([
    getCurrentUser(),
    getIncidentDetail(ref),
    getAppTimeZone(),
  ]);
  if (!incident) notFound();

  return (
    <IncidentReport incident={incident} roles={roles} userId={user?.id ?? null} timeZone={timeZone} />
  );
}
