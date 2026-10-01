import { notFound } from "next/navigation";
import { getCurrentUserRoles } from "@/lib/auth";
import { canAddNote, canAdvanceStatus } from "@/lib/incidents/permissions";
import { getAppTimeZone, getIncidentDetail } from "../../../admin/incidents/actions";
import { Header } from "../../ui";
import { IncidentDetailView } from "./incident-detail";

export const metadata = { title: "Incident · AquaFix" };

export default async function IncidentPage(props: PageProps<"/m/incidents/[reference]">) {
  const { reference } = await props.params;
  const ref = Number(reference);
  if (!Number.isInteger(ref)) notFound();
  const [incident, timeZone, roles] = await Promise.all([getIncidentDetail(ref), getAppTimeZone(), getCurrentUserRoles()]);
  if (!incident) notFound();
  return (
    <>
      <Header title={`Incident ${incident.reference}`} backHref="/m/incidents" />
      <IncidentDetailView
        incident={incident}
        timeZone={timeZone}
        canAdvance={canAdvanceStatus(roles, incident)}
        canNote={canAddNote(roles, incident)}
      />
    </>
  );
}
