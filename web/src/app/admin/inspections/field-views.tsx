"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { formatDateTime } from "@/lib/incidents/format";
import { formatPlainDate } from "@/lib/inspections/dates";
import type { ActivityListRow, InstructionListRow } from "@/lib/inspections/types";
import { ChevronRightIcon, SearchIcon } from "../icons";
import { dangerLinkButtonClass, linkButtonClass } from "../ui";
import { deleteActivity } from "./actions";
import { GradingBadge, Progress } from "./badges";

// Inspection_Overview_PWA: my inspections from today, searchable by asset,
// asset type and location. Edit reopens the capture page (IAC-R06). Delete
// is only offered to admins (field users have no delete right; the Mendix
// PWA showed it anyway and it failed).
export function TodayView({
  activities,
  canDelete,
  timeZone,
}: {
  activities: ActivityListRow[];
  canDelete: boolean;
  timeZone: string;
}) {
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return activities;
    return activities.filter((a) =>
      [a.asset.name, a.asset.asset_type.name, a.asset.location.name].some((v) => v.toLowerCase().includes(q)),
    );
  }, [activities, query]);

  function remove(a: ActivityListRow) {
    if (!confirm(`Delete the inspection of ${a.asset.name}? Its values and photos are deleted too.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteActivity(a.id);
      if (res.error) setError(res.error);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex h-[38px] w-full items-center gap-2 rounded-full border border-border bg-white px-3 text-muted sm:w-80">
        <SearchIcon className="h-4 w-4 shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search asset, type or location…"
          className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted"
        />
      </label>

      {error && <p className="border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">{error}</p>}

      {filtered.length === 0 ? (
        <div className="rounded-card border border-border bg-card px-4 py-10 text-center text-sm text-muted">
          {activities.length === 0 ? "No Inspections Have Been Taken Today" : "Nothing matches your search."}
        </div>
      ) : (
        <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((a) => (
            <div key={a.id} className="flex flex-col rounded-card border border-border bg-card p-4">
              <Link href={`/admin/inspections/activities/${a.legacy_uid}`} className="block flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-ink">{a.asset.name}</div>
                    <div className="text-[13px] text-muted">
                      {a.asset.asset_type.name} · {a.asset.location.name}
                    </div>
                  </div>
                  <GradingBadge grading={a.grading} />
                </div>
                <div className="mt-2 text-xs text-muted">
                  {formatDateTime(a.inspection_date, timeZone)}
                  {a.instruction && ` · ${a.instruction.name}`}
                </div>
              </Link>
              <div className="mt-3 flex gap-4 border-t border-border pt-2.5">
                <Link href={`/admin/inspections/activities/${a.legacy_uid}/edit`} className={linkButtonClass}>
                  Edit
                </Link>
                {canDelete && (
                  <button type="button" className={dangerLinkButtonClass} disabled={isPending} onClick={() => remove(a)}>
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// INS-R07 Instruction_Overview: my open instructions, by due date.
export function MyInstructionsView({
  instructions,
  today,
}: {
  instructions: InstructionListRow[];
  today: string;
}) {
  if (instructions.length === 0) {
    return (
      <div className="rounded-card border border-border bg-card px-4 py-10 text-center text-sm text-muted">
        You have no open instructions.
      </div>
    );
  }
  return (
    <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
      {instructions.map((i) => {
        const overdue = i.required_completed_date < today;
        return (
          <Link
            key={i.id}
            href={`/admin/inspections/instructions/${i.legacy_uid}`}
            className="flex items-center gap-3 rounded-card border border-border bg-card p-4 transition-colors hover:bg-row-hover"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold text-ink">{i.name}</div>
              {i.comment && <p className="mt-0.5 line-clamp-2 text-[13px] text-muted">{i.comment}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <Progress done={i.nr_completed} total={i.nr_of_allocations} />
                <span className={`text-xs ${overdue ? "font-semibold text-danger" : "text-muted"}`}>
                  {overdue ? "Overdue · " : "Due "}
                  {formatPlainDate(i.required_completed_date)}
                </span>
              </div>
            </div>
            <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted" />
          </Link>
        );
      })}
    </div>
  );
}
