// A Save is one write transaction: the local rows (so lists show the record at
// once) plus one outbox row holding the command. PowerSync queues the
// transaction and the connector's uploadData() sends the command.
import type { Transaction } from "@powersync/react-native";
import * as Crypto from "expo-crypto";
import type { Command } from "./types";

export function newId(): string {
  return Crypto.randomUUID();
}

export async function queueCommand(tx: Transaction, cmd: Command, capturedAt: string): Promise<void> {
  const p = cmd.payload as Record<string, unknown>;
  const id = String(p.command_id ?? p.p_command_id);
  await tx.execute("INSERT INTO outbox (id, command_id, command, payload, captured_at) VALUES (?, ?, ?, ?, ?)", [
    id,
    id,
    cmd.command,
    JSON.stringify(cmd.payload),
    capturedAt,
  ]);
}

// Saving a fixed Needs attention item again: the new command (with a new
// command id) replaces the item in the same transaction.
export async function resolveAttention(tx: Transaction, attentionId: string | null | undefined): Promise<void> {
  if (attentionId) await tx.execute("DELETE FROM needs_attention WHERE id = ?", [attentionId]);
}
