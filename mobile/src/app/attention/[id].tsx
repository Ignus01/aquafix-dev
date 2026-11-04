// One Needs attention item: the server's messages, then Open (the original
// form with the messages shown; saving it again queues a new command with a
// new command id) or Discard (after a confirmation; deletes the item and its
// photo files). Nothing is ever deleted without the user choosing to.
import { usePowerSync, useQuery } from "@powersync/react-native";
import { router, useLocalSearchParams } from "expo-router";
import { File } from "expo-file-system";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { advanceStatus } from "../../commands/incident";
import { type AttentionMessages, type Command, COMMAND_LABELS, type CommandName, payloadImages } from "../../commands/types";
import { shortDateTime } from "../../domain/dates";
import { photoIdFromPath } from "../../photos/photos";
import { supabase } from "../../lib/supabase";
import { useApp } from "../../state/app-context";
import { Button, ConfirmDialog, Empty, ErrorBox, Header, HomeBar, Screen } from "../../ui/components";
import { colors } from "../../ui/theme";

export default function AttentionItem() {
  const db = usePowerSync();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { timeZone, captureBlocked, toast } = useApp();
  const { data } = useQuery<{ id: string; command: CommandName; payload: string; messages: string; failed_at: string }>(
    "SELECT id, command, payload, messages, failed_at FROM needs_attention WHERE id = ?",
    [id],
  );
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const row = data[0];

  if (!row) {
    return (
      <Screen>
        <Header title="Needs attention" back />
        <Empty icon="checkmark-circle-outline">This item has been dealt with.</Empty>
        <HomeBar />
      </Screen>
    );
  }

  const cmd = { command: row.command, payload: JSON.parse(row.payload) } as Command;
  const m = JSON.parse(row.messages) as AttentionMessages;
  const capturedAt = String((cmd.payload as Record<string, unknown>).captured_at ?? (cmd.payload as Record<string, unknown>).p_captured_at ?? "");

  function open() {
    switch (cmd.command) {
      case "save_inspection_activity":
        router.push({ pathname: "/inspections/capture", params: { attention: row.id } });
        break;
      case "save_incident":
        router.push({ pathname: "/incidents/new", params: { attention: row.id } });
        break;
      case "add_incident_note":
        router.push({ pathname: "/incidents/[id]", params: { id: cmd.payload.p_incident_id, attention: row.id } });
        break;
      case "save_stock_document":
        router.push({ pathname: "/stock/[kind]/new", params: { kind: cmd.payload.kind, attention: row.id } });
        break;
      case "advance_incident_status":
        break;
    }
  }

  async function retryStatus() {
    if (cmd.command !== "advance_incident_status") return;
    setError(null);
    const incident = await db.getOptional<{ status: string }>("SELECT status FROM incident WHERE id = ?", [cmd.payload.p_incident_id]);
    if (!incident) {
      setError("That incident is no longer on this phone.");
      return;
    }
    if (incident.status === "completed") {
      setError("That incident is already completed. Discard this item.");
      return;
    }
    await advanceStatus(db, cmd.payload.p_incident_id, incident.status as "new" | "in_progress", { attentionId: row.id });
    toast("Queued again");
    router.back();
  }

  async function discard() {
    setConfirmDiscard(false);
    const photos = payloadImages(cmd).flatMap((i) => ("id" in i ? [] : [i]));
    const bucket = cmd.command === "save_inspection_activity" ? "inspection-images" : "incident-images";
    const removable: string[] = [];
    await db.writeTransaction(async (tx) => {
      for (const p of photos) {
        const photoId = photoIdFromPath(p.storage_path);
        const file = await tx.getOptional<{ local_uri: string | null; thumb_uri: string | null; uploaded: number; taken_here: number }>(
          "SELECT local_uri, thumb_uri, uploaded, taken_here FROM photo_file WHERE id = ?",
          [photoId],
        );
        // Keep a photo another row still shows.
        const inUse =
          (await tx.getOptional("SELECT id FROM inspection_image WHERE storage_path = ?", [p.storage_path])) ||
          (await tx.getOptional("SELECT id FROM incident_image WHERE storage_path = ?", [p.storage_path]));
        if (!file || inUse || !file.taken_here) continue;
        for (const uri of [file.local_uri, file.thumb_uri]) {
          try {
            if (uri && new File(uri).exists) new File(uri).delete();
          } catch {
            // Left for the sweep.
          }
        }
        if (file.uploaded) removable.push(p.storage_path, p.thumbnail_path);
        await tx.execute("DELETE FROM photo_file WHERE id = ?", [photoId]);
      }
      await tx.execute("DELETE FROM needs_attention WHERE id = ?", [row.id]);
    });
    if (removable.length > 0) void supabase.storage.from(bucket).remove(removable).catch(() => undefined);
    toast("Discarded");
    router.back();
  }

  return (
    <Screen>
      <Header title="Needs attention" back />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Text style={{ fontSize: 22, fontWeight: "600", color: colors.ink }}>{COMMAND_LABELS[cmd.command]}</Text>
        <Text style={{ fontSize: 16, color: colors.muted }}>
          Captured {shortDateTime(capturedAt, timeZone)} · refused {shortDateTime(row.failed_at, timeZone)}
        </Text>
        <View style={{ backgroundColor: colors.white, borderRadius: 10, padding: 12, gap: 8 }}>
          <Text style={{ fontSize: 16, fontWeight: "600", color: colors.muted }}>THE SERVER SAID</Text>
          {m.kind === "error" ? (
            <Text style={{ fontSize: 18, color: colors.redText }}>
              {m.message}
              {"\n"}
              <Text style={{ fontSize: 14, color: colors.muted }}>({m.code})</Text>
            </Text>
          ) : (
            m.messages.map((x, i) => (
              <Text key={i} style={{ fontSize: 18, color: colors.redText }}>
                • {x.message}
              </Text>
            ))
          )}
        </View>
        <ErrorBox>{error}</ErrorBox>
        {cmd.command === "advance_incident_status" ? (
          <Button title="Try again" onPress={retryStatus} disabled={captureBlocked} />
        ) : (
          <Button title="Open and fix" onPress={open} disabled={captureBlocked} />
        )}
        <Button title="Discard" kind="light" onPress={() => setConfirmDiscard(true)} />
      </ScrollView>
      <HomeBar />
      <ConfirmDialog
        open={confirmDiscard}
        title="Discard"
        message="Discard this save? What was captured in it will be lost."
        proceedLabel="Discard"
        onProceed={discard}
        onCancel={() => setConfirmDiscard(false)}
      />
    </Screen>
  );
}
