import { requireRole } from "@/lib/auth";
import { INCIDENT_WRITERS } from "@/lib/incidents/permissions";
import { listIncidentFormOptions } from "../../../admin/incidents/actions";
import { Header } from "../../ui";
import { IncidentForm } from "./incident-form";

export const metadata = { title: "New incident · AquaFix" };

export default async function NewIncidentPage() {
  await requireRole(INCIDENT_WRITERS);
  const { types, locations } = await listIncidentFormOptions();
  return (
    <>
      <Header title="New Incident" />
      <IncidentForm
        types={types.filter((t) => t.active)}
        locations={locations.filter((l) => l.active && l.is_asset_manager)}
      />
    </>
  );
}
