import type { MasterdataRole } from "@/lib/auth";
import type { IncidentStatus } from "./types";

// Mirrors the RLS policies and RPC role checks in
// supabase/migrations/20260923150000_incidents_rls.sql. Used only to decide
// what to render — the database is the real enforcement point.

const WRITERS: MasterdataRole[] = ["system_admin", "admin", "user"];
const ADMINS: MasterdataRole[] = ["system_admin", "admin"];

const hasAny = (roles: MasterdataRole[], allowed: MasterdataRole[]) =>
  roles.some((r) => allowed.includes(r));

export const INCIDENT_READERS: MasterdataRole[] = ["system_admin", "admin", "user", "viewer"];
export const INCIDENT_WRITERS = WRITERS;

export function isIncidentWriter(roles: MasterdataRole[]) {
  return hasAny(roles, WRITERS);
}

export function isIncidentAdmin(roles: MasterdataRole[]) {
  return hasAny(roles, ADMINS);
}

type IncidentRef = { status: IncidentStatus; created_by: string | null };

// Admins always; the creator while the incident isn't completed.
export function canEditIncident(roles: MasterdataRole[], userId: string | null, incident: IncidentRef) {
  if (isIncidentAdmin(roles)) return true;
  return (
    isIncidentWriter(roles) && incident.created_by === userId && incident.status !== "completed"
  );
}

// ICD-R06: the one-tap advance, for every writer.
export function canAdvanceStatus(roles: MasterdataRole[], incident: IncidentRef) {
  return isIncidentWriter(roles) && incident.status !== "completed";
}

// ICN-R03.
export function canAddNote(roles: MasterdataRole[], incident: IncidentRef) {
  return isIncidentWriter(roles) && incident.status !== "completed";
}
