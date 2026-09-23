"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { MasterdataRole } from "@/lib/auth";
import {
  canAddNote,
  canAdvanceStatus,
  canEditIncident,
  isIncidentAdmin,
} from "@/lib/incidents/permissions";
import { formatDateTime } from "@/lib/incidents/format";
import { discardUploads } from "@/lib/incidents/image-upload";
import { STATUS_LABELS, type FormImage, type IncidentDetail } from "@/lib/incidents/types";
import { AlertTriangleIcon, ChevronLeftIcon } from "../../icons";
import { inputClass, primaryButtonClass, secondaryButtonClass, sectionHeadingClass } from "../../ui";
import { addIncidentNote, deleteIncident } from "../actions";
import { Gallery, PhotoPicker } from "../photos";
import { StatusControl } from "../status-control";

function Card({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded-card border border-border bg-card">
      <div className="flex min-h-[48px] items-center justify-between gap-3 border-b border-border px-5 py-2.5">
        <h2 className={sectionHeadingClass}>{title}</h2>
        {action}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-4">
      <dt className="w-32 shrink-0 text-[13px] text-muted">{label}</dt>
      <dd className="text-sm text-ink">{children}</dd>
    </div>
  );
}

export function IncidentReport({
  incident,
  roles,
  userId,
  timeZone,
}: {
  incident: IncidentDetail;
  roles: MasterdataRole[];
  userId: string | null;
  timeZone: string;
}) {
  const router = useRouter();
  const isAdmin = isIncidentAdmin(roles);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function remove() {
    if (!confirm(`Delete incident ${incident.reference}? Its notes and photos are deleted too. This cannot be undone.`)) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await deleteIncident(incident.id);
      if (res.error) setError(res.error);
      else router.push("/admin/incidents");
    });
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-wrap items-end justify-between gap-4 px-4 pt-6 pb-2 md:px-8 md:pt-8">
        <div className="flex flex-col gap-2">
          <Link
            href="/admin/incidents"
            className="flex items-center gap-1 text-[13px] text-muted hover:text-ink"
          >
            <ChevronLeftIcon className="h-4 w-4" />
            Incidents
          </Link>
          <div className="flex flex-wrap items-center gap-3">
            <AlertTriangleIcon className="h-6 w-6 text-warning" />
            <h1 className="text-[26px] leading-tight font-bold tracking-tight text-ink">
              Incident report <span className="font-mono">{incident.reference}</span>
            </h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <StatusControl
            incident={incident}
            canAdvance={canAdvanceStatus(roles, incident)}
            canSetAny={isAdmin}
            size="md"
          />
          {canEditIncident(roles, userId, incident) && (
            <Link
              href={`/admin/incidents/${incident.reference}/edit`}
              className={`${secondaryButtonClass} flex items-center`}
            >
              Edit
            </Link>
          )}
          {isAdmin && (
            <button
              type="button"
              disabled={isPending}
              onClick={remove}
              className="h-[40px] rounded-control border border-danger/30 bg-white px-4 text-sm font-medium text-danger transition-colors hover:bg-danger-bg disabled:opacity-60"
            >
              Delete
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="mx-4 mt-2 border-l-2 border-danger py-1 pl-3 text-[13px] text-danger md:mx-8">
          {error}
        </p>
      )}

      <div className="grid gap-5 px-4 pt-4 pb-10 md:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card title="Incident detail">
            <dl className="flex flex-col gap-2.5">
              <Detail label="Type">{incident.incident_type.name}</Detail>
              <Detail label="Location">{incident.location.name}</Detail>
              <Detail label="Status">{STATUS_LABELS[incident.status]}</Detail>
              <Detail label="Logged">{formatDateTime(incident.incident_date, timeZone)}</Detail>
              {incident.status === "completed" && (
                <Detail label="Completed">{formatDateTime(incident.completed_at, timeZone)}</Detail>
              )}
              <Detail label="Logged by">{incident.created_by_name ?? "—"}</Detail>
            </dl>
            {incident.incident_type.disables_location && incident.status !== "completed" && (
              <p className="mt-4 rounded-control bg-danger-bg px-3 py-2 text-[13px] text-danger">
                {incident.location.name} is not operational while this incident is open.
              </p>
            )}
          </Card>

          <Card title="Comment">
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink">{incident.comment}</p>
          </Card>

          <Card title={`Photos (${incident.images.length})`}>
            <Gallery images={incident.images} canDownload={isAdmin} emptyLabel="No photos." />
          </Card>

          <Card title="Status history">
            <ol className="flex flex-col gap-2.5">
              {incident.history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                  <span className="font-medium text-ink">
                    {h.from_status
                      ? `${STATUS_LABELS[h.from_status]} → ${STATUS_LABELS[h.to_status]}`
                      : `Logged as ${STATUS_LABELS[h.to_status]}`}
                  </span>
                  <span className="text-muted">
                    {formatDateTime(h.changed_at, timeZone)}
                    {h.changed_by_name && ` · ${h.changed_by_name}`}
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          {canAddNote(roles, incident) && (
            <AddNote incidentId={incident.id} reference={incident.reference} />
          )}

          <Card title={`Notes (${incident.notes.length})`}>
            {incident.notes.length === 0 ? (
              <p className="text-[13px] text-muted">No notes yet.</p>
            ) : (
              <ul className="flex flex-col gap-4">
                {incident.notes.map((n) => (
                  <li key={n.id} className="flex flex-col gap-2 border-b border-border pb-4 last:border-b-0 last:pb-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-muted">
                      <span className="font-semibold text-ink">{n.created_by_name ?? "Unknown"}</span>
                      <span>{formatDateTime(n.created_at, timeZone)}</span>
                    </div>
                    <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink">{n.body}</p>
                    <Gallery images={n.images} canDownload={isAdmin} small />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

// Incident_AddNote — a follow-up note with its own photos, only while the
// incident is open (ICN-R03). Notes can't be edited afterwards (ICN-R04).
function AddNote({ incidentId, reference }: { incidentId: string; reference: number }) {
  const [body, setBody] = useState("");
  const [images, setImages] = useState<FormImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const uploading = images.some((i) => i.uploading);
  const uploads = images.filter((i) => i.upload && !i.error).map((i) => i.upload!);

  function save() {
    setError(null);
    if (!body.trim()) {
      setError("Required");
      return;
    }
    startTransition(async () => {
      const res = await addIncidentNote(incidentId, reference, body, uploads);
      if (res.error) {
        setError(res.error);
        return;
      }
      setBody("");
      setImages([]);
    });
  }

  function clear() {
    void discardUploads(uploads);
    setBody("");
    setImages([]);
    setError(null);
  }

  return (
    <Card title="Add note">
      <div className="flex flex-col gap-3">
        <textarea
          rows={4}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Enter note"
          aria-label="Note"
          className={`${inputClass} !h-auto py-2.5`}
        />
        {error && <span className="-mt-1 text-xs text-danger">{error}</span>}
        <PhotoPicker images={images} onChange={setImages} disabled={isPending} />
        <div className="flex justify-end gap-2">
          {(body || images.length > 0) && (
            <button type="button" disabled={isPending} onClick={clear} className={secondaryButtonClass}>
              Clear
            </button>
          )}
          <button
            type="button"
            disabled={isPending || uploading}
            onClick={save}
            className={primaryButtonClass}
          >
            {isPending ? "Saving…" : uploading ? "Uploading…" : "Save note"}
          </button>
        </div>
      </div>
    </Card>
  );
}
