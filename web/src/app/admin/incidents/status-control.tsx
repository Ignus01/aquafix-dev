"use client";

import { useState, useTransition } from "react";
import { STATUS_LABELS, INCIDENT_STATUSES, type IncidentStatus } from "@/lib/incidents/types";
import { advanceIncidentStatus, setIncidentStatus } from "./actions";

const STATUS_STYLES: Record<IncidentStatus, { pill: string; dot: string }> = {
  new: { pill: "bg-warning-bg text-warning", dot: "bg-warning" },
  in_progress: { pill: "bg-primary/10 text-primary", dot: "bg-primary" },
  completed: { pill: "bg-success-bg text-success", dot: "bg-success" },
};

export function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  const s = STATUS_STYLES[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${s.pill}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {STATUS_LABELS[status]}
    </span>
  );
}

// ICD-R06's "next step" wording for the advance button.
const ADVANCE_LABEL: Partial<Record<IncidentStatus, string>> = {
  new: "Start",
  in_progress: "Complete",
};

// The status badge plus its actions:
// - writers get a one-tap advance (New → In Progress → Completed, ICD-R06).
//   Completing asks first, since only an admin can reopen.
// - admins also get a menu to set any status, including reopening (ICD-R07).
export function StatusControl({
  incident,
  canAdvance,
  canSetAny,
  size = "sm",
}: {
  incident: { id: string; reference: number; status: IncidentStatus };
  canAdvance: boolean;
  canSetAny: boolean;
  size?: "sm" | "md";
}) {
  const [isPending, startTransition] = useTransition();
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const advanceLabel = ADVANCE_LABEL[incident.status];

  function advance() {
    if (
      incident.status === "in_progress" &&
      !confirm(`Mark incident ${incident.reference} as completed?`)
    ) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await advanceIncidentStatus(incident.id, incident.status, incident.reference);
      if (res.error) setError(res.error);
    });
  }

  function setStatus(status: IncidentStatus) {
    setMenuOpen(false);
    if (status === incident.status) return;
    setError(null);
    startTransition(async () => {
      const res = await setIncidentStatus(incident.id, status, incident.reference);
      if (res.error) setError(res.error);
    });
  }

  const buttonClass =
    size === "md"
      ? "h-[34px] px-3 text-[13px]"
      : "h-[26px] px-2 text-xs";

  return (
    <div className="relative inline-flex flex-col items-start gap-1">
      <div className="flex items-center gap-2">
        <IncidentStatusBadge status={incident.status} />
        {canAdvance && advanceLabel && (
          <button
            type="button"
            disabled={isPending}
            onClick={advance}
            className={`rounded-control border border-border bg-white font-semibold text-ink transition-colors hover:bg-black/[.03] disabled:opacity-60 ${buttonClass}`}
          >
            {isPending ? "…" : advanceLabel}
          </button>
        )}
        {canSetAny && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Set status"
            aria-expanded={menuOpen}
            className={`rounded-control font-semibold text-muted transition-colors hover:bg-black/[.04] hover:text-ink disabled:opacity-60 ${buttonClass}`}
          >
            •••
          </button>
        )}
      </div>

      {menuOpen && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} aria-hidden="true" />
          <div className="absolute top-full left-0 z-40 mt-1 w-44 overflow-hidden rounded-control border border-border bg-card py-1 shadow-lg">
            <div className="px-3 py-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">
              Set status
            </div>
            {INCIDENT_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-row-hover ${
                  s === incident.status ? "font-semibold text-primary" : "text-ink"
                }`}
              >
                {STATUS_LABELS[s]}
                {s === incident.status && <span className="text-xs">current</span>}
              </button>
            ))}
          </div>
        </>
      )}

      {error && <span className="max-w-[240px] text-xs text-danger">{error}</span>}
    </div>
  );
}
