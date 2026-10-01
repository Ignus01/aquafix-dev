"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { discardUploads } from "@/lib/incidents/image-upload";
import { STATUS_LABELS, type FormImage, type IncidentDetail } from "@/lib/incidents/types";
import { addIncidentNote, advanceIncidentStatus } from "../../../admin/incidents/actions";
import { Gallery, PhotoPicker } from "../../../admin/incidents/photos";
import { ConfirmDialog, Sheet } from "../../components";
import { shortDateTime } from "../../format";
import { PinIcon } from "../../icons";
import { ErrorLine, StatusPill, mBtnDark, mBtnGreen, mInput } from "../../ui";

const ADVANCE_LABEL = { new: "Start", in_progress: "Complete" } as const;

export function IncidentDetailView({
  incident,
  timeZone,
  canAdvance,
  canNote,
}: {
  incident: IncidentDetail;
  timeZone: string;
  canAdvance: boolean;
  canNote: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [body, setBody] = useState("");
  const [noteImages, setNoteImages] = useState<FormImage[]>([]);
  const [noteError, setNoteError] = useState<string | null>(null);

  const advanceLabel = incident.status === "completed" ? null : ADVANCE_LABEL[incident.status];

  function advance() {
    setConfirmComplete(false);
    setError(null);
    startTransition(async () => {
      const res = await advanceIncidentStatus(incident.id, incident.status, incident.reference);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  function saveNote() {
    setNoteError(null);
    if (!body.trim()) {
      setNoteError("Note is required.");
      return;
    }
    startTransition(async () => {
      const uploads = noteImages.filter((i) => !i.error && i.upload).map((i) => i.upload!);
      const res = await addIncidentNote(incident.id, incident.reference, body, uploads);
      if (res.error) {
        setNoteError(res.error);
        return;
      }
      setNoteOpen(false);
      setBody("");
      setNoteImages([]);
      router.refresh();
    });
  }

  function closeNote() {
    void discardUploads(noteImages.filter((i) => i.upload).map((i) => i.upload!));
    setNoteImages([]);
    setBody("");
    setNoteError(null);
    setNoteOpen(false);
  }

  return (
    <div className="flex-1 pb-4">
      <section className="bg-white px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[22px] font-semibold">{incident.incident_type.name}</h2>
          <StatusPill status={incident.status} label={STATUS_LABELS[incident.status]} />
        </div>
        <div className="mt-2 flex items-center gap-2 text-[17px] font-semibold text-[#5b6480] uppercase">
          <PinIcon className="h-4 w-4 text-[#0b1426]" />
          {incident.location.name}
        </div>
        <p className="mt-1 text-[16px] text-[#5b6480]">
          {incident.created_by_name ?? "—"} · {shortDateTime(incident.incident_date, timeZone)}
        </p>
        <p className="mt-3 text-[20px] leading-snug whitespace-pre-line">{incident.comment}</p>
        {incident.images.length > 0 && (
          <div className="mt-3">
            <Gallery images={incident.images} canDownload={false} small />
          </div>
        )}
        {error && <ErrorLine>{error}</ErrorLine>}
        <div className="mt-4 flex gap-3">
          {canAdvance && advanceLabel && (
            <button
              type="button"
              disabled={isPending}
              className={mBtnGreen}
              onClick={() => (incident.status === "in_progress" ? setConfirmComplete(true) : advance())}
            >
              {advanceLabel}
            </button>
          )}
          {canNote && (
            <button type="button" className={mBtnDark} onClick={() => setNoteOpen(true)}>
              Add Note
            </button>
          )}
        </div>
      </section>

      <h3 className="px-4 pt-4 pb-1 text-[16px] font-semibold tracking-wide text-[#5b6480] uppercase">
        Notes ({incident.notes.length})
      </h3>
      <ul className="bg-white">
        {incident.notes.length === 0 && <li className="px-4 py-4 text-[17px] text-[#5b6480]">No notes yet.</li>}
        {incident.notes.map((n) => (
          <li key={n.id} className="border-b border-[#dfe2e8] px-4 py-3">
            <p className="text-[19px] whitespace-pre-line">{n.body}</p>
            <p className="mt-1 text-[14px] text-[#5b6480]">
              {n.created_by_name ?? "—"} · {shortDateTime(n.created_at, timeZone)}
            </p>
            {n.images.length > 0 && (
              <div className="mt-2">
                <Gallery images={n.images} canDownload={false} small />
              </div>
            )}
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={confirmComplete}
        message={`Mark incident ${incident.reference} as completed?`}
        onProceed={advance}
        onCancel={() => setConfirmComplete(false)}
      />

      {noteOpen && (
        <Sheet
          title="Add Note"
          onClose={closeNote}
          footer={
            <div className="flex w-full justify-between">
              <button type="button" className="h-[48px] rounded-[8px] border border-[#dfe2e8] bg-white px-6 text-[17px]" onClick={closeNote}>
                Cancel
              </button>
              <button
                type="button"
                className={mBtnGreen}
                disabled={isPending || noteImages.some((i) => i.uploading)}
                onClick={saveNote}
              >
                {isPending ? "Saving…" : "Save"}
              </button>
            </div>
          }
        >
          <div className="flex flex-col gap-4 p-4">
            <textarea
              rows={4}
              className={`${mInput} !h-auto py-3`}
              placeholder="Note"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <ErrorLine>{noteError}</ErrorLine>
            <PhotoPicker images={noteImages} onChange={setNoteImages} />
          </div>
        </Sheet>
      )}
    </div>
  );
}
