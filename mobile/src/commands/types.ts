// The five outbox commands (spec "Outbox commands", Appendix A.1–A.5). Each
// payload is exactly what its RPC receives.
import type { PayloadImage } from "../photos/photos";
import type { StockKind } from "../domain/permissions";

export type InspectionPayload = {
  command_id: string;
  captured_at: string;
  activity_id: string;
  asset_id: string;
  instruction_id: string | null;
  values: {
    id: string;
    inspection_id: string;
    is_current: boolean;
    text_value: string;
    decimal_value: number;
    date_value: string | null;
    drop_down_option_id: string | null;
    images: PayloadImage[];
  }[];
};

export type IncidentPayload = {
  command_id: string;
  client_id: string;
  captured_at: string;
  incident_type_id: string;
  location_id: string;
  comment: string;
  images: PayloadImage[];
};

export type NotePayload = {
  p_incident_id: string;
  p_body: string;
  p_images: PayloadImage[];
  p_note_id: string;
  p_command_id: string;
  p_captured_at: string;
};

export type AdvancePayload = {
  p_incident_id: string;
  p_expected_status: "new" | "in_progress";
  p_command_id: string;
  p_captured_at: string;
};

export type StockPayload = {
  command_id: string;
  captured_at: string;
  kind: StockKind;
  header: Record<string, string | number | boolean | null>;
  lines: Record<string, string | number | boolean | null>[];
};

export type Command =
  | { command: "save_inspection_activity"; payload: InspectionPayload }
  | { command: "save_incident"; payload: IncidentPayload }
  | { command: "add_incident_note"; payload: NotePayload }
  | { command: "advance_incident_status"; payload: AdvancePayload }
  | { command: "save_stock_document"; payload: StockPayload };

export type CommandName = Command["command"];

export const COMMAND_LABELS: Record<CommandName, string> = {
  save_inspection_activity: "Inspection",
  save_incident: "New incident",
  add_incident_note: "Incident note",
  advance_incident_status: "Incident status",
  save_stock_document: "Stock document",
};

// What a Needs attention row keeps from the server.
export type AttentionMessages =
  | { kind: "rejected"; messages: { kind: "field" | "popup"; value_id: string; field?: string; message: string }[]; retries: { superseded_id: string; new_id: string; inspection_id: string }[] }
  | { kind: "error"; code: string; message: string };

export function commandId(c: Command): string {
  const p = c.payload as Record<string, unknown>;
  return String(p.command_id ?? p.p_command_id);
}

export function payloadImages(c: Command): PayloadImage[] {
  switch (c.command) {
    case "save_inspection_activity":
      return c.payload.values.flatMap((v) => v.images);
    case "save_incident":
      return c.payload.images;
    case "add_incident_note":
      return c.payload.p_images;
    default:
      return [];
  }
}

export function commandBucket(c: Command): string | null {
  if (c.command === "save_inspection_activity") return "inspection-images";
  if (c.command === "save_incident" || c.command === "add_incident_note") return "incident-images";
  return null;
}

export function attentionSummary(m: AttentionMessages): string {
  if (m.kind === "error") return m.message;
  const first = m.messages[0]?.message ?? "The server didn't accept this save.";
  return m.messages.length > 1 ? `${first} (+${m.messages.length - 1} more)` : first;
}
