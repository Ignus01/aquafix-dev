import type { MasterdataRole } from "@/lib/auth";
import { INSPECTION_BACK_OFFICE } from "@/lib/inspections/permissions";
import { instructionsGrid } from "./specs/instructions";
import type { GridSpec } from "./types";

// Server-mode grids by id, for the export route (/admin/export/[grid]). The
// roles mirror who can open the grid's page; RLS still applies to the rows.
export const GRID_REGISTRY: Record<string, { spec: GridSpec; roles: MasterdataRole[] }> = {
  [instructionsGrid.id]: { spec: instructionsGrid, roles: INSPECTION_BACK_OFFICE },
};
