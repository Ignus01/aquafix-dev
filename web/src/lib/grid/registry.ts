import type { MasterdataRole } from "@/lib/auth";
import { INCIDENT_ADMINS } from "@/lib/incidents/permissions";
import { INSPECTION_BACK_OFFICE } from "@/lib/inspections/permissions";
import { SERVICE_READERS } from "@/lib/services/permissions";
import { incidentsGrid } from "./specs/incidents";
import { openServicesGrid, servicesGrid } from "./specs/services";
import { activitiesGrid, cumulativeGrid, scheduledGrid, valuesGrid } from "./specs/inspections";
import { instructionsGrid } from "./specs/instructions";
import type { GridSpec } from "./types";

// Server-mode grids by id, for the export route (/admin/export/[grid]). The
// roles mirror who can open the grid's page; RLS still applies to the rows.
const entries: { spec: GridSpec; roles: MasterdataRole[] }[] = [
  { spec: instructionsGrid, roles: INSPECTION_BACK_OFFICE },
  { spec: scheduledGrid, roles: INSPECTION_BACK_OFFICE },
  { spec: activitiesGrid, roles: INSPECTION_BACK_OFFICE },
  { spec: valuesGrid, roles: INSPECTION_BACK_OFFICE },
  { spec: cumulativeGrid, roles: INSPECTION_BACK_OFFICE },
  // Export was an admin action on Incident_Overview.
  { spec: incidentsGrid, roles: INCIDENT_ADMINS },
  { spec: servicesGrid, roles: SERVICE_READERS },
  { spec: openServicesGrid, roles: SERVICE_READERS },
];

export const GRID_REGISTRY: Record<string, { spec: GridSpec; roles: MasterdataRole[] }> = Object.fromEntries(
  entries.map((e) => [e.spec.id, e]),
);
