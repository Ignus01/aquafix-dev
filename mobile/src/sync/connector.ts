// The PowerSync backend connector (spec "PowerSync setup guide" B.3 and "How
// uploadData() handles one transaction").
//
// Down: fetchCredentials() hands PowerSync the current Supabase access token.
// Up: uploadData() takes queued Save transactions in order, finds each one's
// outbox row and calls that command's RPC. The other rows in the transaction
// are the Save's local copies; the RPC writes the real ones and the next sync
// replaces the local copies with the server's.
import {
  type CommonPowerSyncDatabase,
  type CrudEntry,
  type PowerSyncBackendConnector,
  type PowerSyncCredentials,
  UpdateType,
} from "@powersync/react-native";
import { POWERSYNC_URL } from "../config";
import { type Classified, classifyRpcFailure, isNetworkError } from "../domain/upload-errors";
import { logUploadProblem } from "../lib/sentry";
import { requireSession, supabase } from "../lib/supabase";
import { OUTBOX } from "../db/schema";
import { type AttentionMessages, type Command, commandId } from "../commands/types";
import { afterConfirmedSave, uploadCommandPhotos } from "./photo-sync";

class TransientError extends Error {}

function readCommand(entry: CrudEntry): Command | null {
  const data = entry.opData ?? {};
  try {
    return { command: data.command, payload: JSON.parse(String(data.payload)) } as Command;
  } catch {
    return null;
  }
}

type Outcome = { kind: "done"; result: unknown } | { kind: "rejected"; messages: AttentionMessages };

async function callRpc(cmd: Command): Promise<Outcome> {
  let response: { data: unknown; error: { code?: string; message?: string } | null; status?: number };
  try {
    switch (cmd.command) {
      case "save_inspection_activity":
        response = await supabase.rpc("save_inspection_activity", { p_activity: cmd.payload });
        break;
      case "save_incident":
        response = await supabase.rpc("save_incident", { p_incident: cmd.payload });
        break;
      case "save_stock_document":
        response = await supabase.rpc("save_stock_document", { p_doc: cmd.payload });
        break;
      case "add_incident_note":
      case "advance_incident_status":
        response = await supabase.rpc(cmd.command, cmd.payload);
        break;
    }
  } catch (e) {
    // fetch threw: no network, timeout, aborted.
    throw new TransientError(e instanceof Error ? e.message : String(e));
  }

  if (response.error) {
    const c: Classified = classifyRpcFailure({ status: response.status, code: response.error.code, message: response.error.message });
    if (c.kind === "transient") {
      logUploadProblem(cmd.command, response.error.code || `HTTP ${response.status ?? 0}`, "transient");
      throw new TransientError(response.error.message ?? "Upload failed; will retry.");
    }
    return { kind: "rejected", messages: { kind: "error", code: c.code, message: c.message } };
  }

  // save_inspection_activity's returned rejection (ok:false), fresh or stored.
  const data = response.data as { ok?: boolean; messages?: never[]; retries?: never[] } | null;
  if (cmd.command === "save_inspection_activity" && data && data.ok === false) {
    return { kind: "rejected", messages: { kind: "rejected", messages: data.messages ?? [], retries: data.retries ?? [] } };
  }
  return { kind: "done", result: response.data };
}

async function recordAttention(database: CommonPowerSyncDatabase, cmd: Command, messages: AttentionMessages): Promise<void> {
  const code = messages.kind === "error" ? messages.code : "ok:false";
  logUploadProblem(cmd.command, code, messages.kind);
  await database.execute(
    "INSERT INTO needs_attention (id, command_id, command, payload, messages, failed_at) VALUES (uuid(), ?, ?, ?, ?, ?)",
    [commandId(cmd), cmd.command, JSON.stringify(cmd.payload), JSON.stringify(messages), new Date().toISOString()],
  );
}

// Sends one queued command. Throws only for a transient failure, so PowerSync
// retries the same transaction later; everything else ends here.
async function sendCommand(database: CommonPowerSyncDatabase, cmd: Command, userId: string): Promise<void> {
  try {
    await uploadCommandPhotos(database, cmd, userId);
  } catch (e) {
    if (e instanceof TransientError || isNetworkError(e) || (e as { transient?: boolean }).transient) throw e;
    await recordAttention(database, cmd, { kind: "error", code: "photo", message: e instanceof Error ? e.message : String(e) });
    return;
  }

  const outcome = await callRpc(cmd);
  if (outcome.kind === "rejected") {
    await recordAttention(database, cmd, outcome.messages);
    return;
  }
  await afterConfirmedSave(database, cmd, outcome.result);
}

export class SupabaseConnector implements PowerSyncBackendConnector {
  async fetchCredentials(): Promise<PowerSyncCredentials | null> {
    const session = await requireSession();
    return {
      endpoint: POWERSYNC_URL,
      token: session.access_token,
      expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : undefined,
    };
  }

  async uploadData(database: CommonPowerSyncDatabase): Promise<void> {
    // Commands go up strictly in the order they were saved.
    for (;;) {
      const tx = await database.getNextCrudTransaction();
      if (!tx) return;

      const entry = tx.crud.find((c) => c.table === OUTBOX && c.op === UpdateType.PUT);
      const cmd = entry ? readCommand(entry) : null;
      if (!cmd) {
        // A stray local write with no command (or an unreadable one).
        await tx.complete();
        continue;
      }

      const session = await requireSession(); // throws → retried later
      await sendCommand(database, cmd, session.user.id);
      await tx.complete();
    }
  }
}
