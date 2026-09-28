"use client";

import { useState, useTransition } from "react";
import { formatDateTime } from "@/lib/incidents/format";
import { formatPlainDate } from "@/lib/inspections/dates";
import {
  SCHEDULE_TYPE_LABELS,
  WEEK_DAYS,
  type AccountOption,
  type AssetOption,
  type PublicHoliday,
  type ScheduleRun,
  type ScheduledInstructionRow,
} from "@/lib/inspections/types";
import { PlusIcon } from "../icons";
import { Modal } from "../modal";
import { StatusBadge } from "../status-badge";
import { dangerLinkButtonClass, inputClass, linkButtonClass, primaryButtonClass } from "../ui";
import { createPublicHoliday, deletePublicHoliday, deleteScheduledInstruction, runSchedule } from "./actions";
import { YesNo } from "./badges";
import { DataTable, type Column } from "./data-table";
import { addButtonClass } from "./instructions-panel";
import { ScheduleEditor } from "./schedule-editor";

function describeSchedule(s: ScheduledInstructionRow) {
  if (s.schedule_type === "weekly") {
    return WEEK_DAYS.filter((d) => s.week_days.includes(d.value))
      .map((d) => d.short)
      .join(", ");
  }
  if (s.schedule_type === "monthly") return `Day ${s.day_of_month}`;
  return [s.include_weekends ? "incl. weekends" : "weekdays", s.include_public_holidays ? "incl. holidays" : null]
    .filter(Boolean)
    .join(", ");
}

// Inspection_Overview → Instructions → Scheduled Instructions, with the
// "Run Schedule" button (SCH-R10), the issuing log and the public-holiday
// calendar the Daily schedules use.
export function SchedulesPanel({
  schedules,
  runs,
  holidays,
  assets,
  accounts,
  canEdit,
  timeZone,
}: {
  schedules: ScheduledInstructionRow[];
  runs: ScheduleRun[];
  holidays: PublicHoliday[];
  assets: AssetOption[];
  accounts: AccountOption[];
  canEdit: boolean;
  timeZone: string;
}) {
  const [editor, setEditor] = useState<null | { schedule: ScheduledInstructionRow | null }>(null);
  const [holidaysOpen, setHolidaysOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function remove(row: ScheduledInstructionRow) {
    if (!confirm(`Delete scheduled instruction ${row.legacy_uid}? Instructions it already issued are kept.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteScheduledInstruction(row.id);
      if (res.error) setError(res.error);
    });
  }

  function run() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await runSchedule();
      if (res.error) {
        setError(res.error);
        return;
      }
      const problems = res.problems ?? [];
      setNotice(
        `${res.issued} instruction${res.issued === 1 ? "" : "s"} issued for today.` +
          (problems.length ? ` Not issued: ${problems.map((p) => `${p.name} (${p.reason})`).join("; ")}` : ""),
      );
    });
  }

  const columns: Column<ScheduledInstructionRow>[] = [
    {
      key: "uid",
      label: "UID",
      text: (r) => r.legacy_uid,
      render: (r) => (
        <button
          type="button"
          onClick={() => setEditor({ schedule: r })}
          className="font-mono text-[13px] font-semibold text-primary hover:text-primary-hover"
        >
          {r.legacy_uid}
        </button>
      ),
    },
    { key: "name", label: "Name", text: (r) => r.name, render: (r) => r.name },
    {
      key: "comment",
      label: "Comment",
      text: (r) => r.comment,
      className: "",
      render: (r) =>
        r.comment ? (
          <span className="line-clamp-1 max-w-[200px] text-muted" title={r.comment}>
            {r.comment}
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    { key: "account", label: "Assigned to", text: (r) => r.account_name, render: (r) => r.account_name ?? "—" },
    {
      key: "type",
      label: "Schedule",
      text: (r) => `${SCHEDULE_TYPE_LABELS[r.schedule_type]} ${describeSchedule(r)}`,
      render: (r) => (
        <span>
          {SCHEDULE_TYPE_LABELS[r.schedule_type]}
          <span className="ml-1.5 text-xs text-muted">{describeSchedule(r)}</span>
        </span>
      ),
    },
    {
      key: "weekends",
      label: "Weekends",
      text: (r) => (r.include_weekends ? "Yes" : "No"),
      render: (r) => <YesNo value={r.include_weekends} />,
    },
    {
      key: "holidays",
      label: "Public holidays",
      text: (r) => (r.include_public_holidays ? "Yes" : "No"),
      render: (r) => <YesNo value={r.include_public_holidays} />,
    },
    {
      key: "day",
      label: "Day of month",
      text: (r) => r.day_of_month,
      render: (r) => r.day_of_month ?? <span className="text-muted">—</span>,
    },
    { key: "days", label: "Days to complete", text: (r) => r.days_to_complete, render: (r) => r.days_to_complete },
    { key: "assets", label: "Assets", text: (r) => r.asset_ids.length, render: (r) => r.asset_ids.length },
    {
      key: "active",
      label: "Active",
      text: (r) => (r.active ? "Active" : "Inactive"),
      render: (r) => <StatusBadge active={r.active} />,
    },
  ];

  const lastRun = runs[0];

  return (
    <>
      {error && <p className="mb-4 border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">{error}</p>}
      {notice && <p className="mb-4 border-l-2 border-success py-1 pl-3 text-[13px] text-success">{notice}</p>}

      <DataTable
        rows={schedules}
        columns={columns}
        getKey={(r) => r.id}
        emptyLabel="No scheduled instructions yet."
        searchPlaceholder="Search schedules…"
        exportName="scheduled-instructions"
        toolbar={
          <>
            <button
              type="button"
              onClick={() => setHolidaysOpen(true)}
              className="flex h-[38px] items-center rounded-control border border-border bg-white px-3.5 text-sm font-medium text-ink transition-colors hover:bg-black/[.02]"
            >
              Public holidays
            </button>
            {canEdit && (
              <>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={run}
                  className="flex h-[38px] items-center rounded-control border border-warning/40 bg-warning-bg px-3.5 text-sm font-semibold text-warning transition-colors hover:bg-warning/15 disabled:opacity-60"
                  title="Issue today's instructions now. Schedules already issued today are skipped."
                >
                  {isPending ? "Running…" : "Run schedule"}
                </button>
                <button type="button" className={addButtonClass} onClick={() => setEditor({ schedule: null })}>
                  <PlusIcon className="h-4 w-4" />
                  Add new
                </button>
              </>
            )}
          </>
        }
        actions={(r) => (
          <span className="flex justify-end gap-3">
            <button type="button" className={linkButtonClass} onClick={() => setEditor({ schedule: r })}>
              {canEdit ? "Edit" : "View"}
            </button>
            {canEdit && (
              <button type="button" className={dangerLinkButtonClass} disabled={isPending} onClick={() => remove(r)}>
                Delete
              </button>
            )}
          </span>
        )}
      />

      {runs.length > 0 && (
        <details className="mt-4 rounded-card border border-border bg-card">
          <summary className="cursor-pointer px-4 py-3 text-[13px] text-muted">
            Last run: <span className="text-ink">{formatDateTime(lastRun.started_at, timeZone)}</span> ·{" "}
            {lastRun.trigger === "cron" ? "daily job" : "manual"} · {lastRun.issued_count} issued ·{" "}
            <RunStatus status={lastRun.status} />
          </summary>
          <ul className="border-t border-border px-4 py-2">
            {runs.map((r) => (
              <li key={r.id} className="flex flex-wrap gap-x-3 py-1.5 text-[13px]">
                <span className="w-40 text-ink">{formatDateTime(r.started_at, timeZone)}</span>
                <span className="w-20 text-muted">{r.trigger === "cron" ? "daily job" : "manual"}</span>
                <span className="w-20 text-ink">{r.issued_count} issued</span>
                <RunStatus status={r.status} />
                {r.problems.length > 0 && (
                  <span className="basis-full pl-0 text-xs text-muted sm:pl-40">
                    {r.problems.map((p) => `${p.name}: ${p.reason}`).join(" · ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {editor && (
        <ScheduleEditor
          key={editor.schedule?.id ?? "new"}
          schedule={editor.schedule}
          assets={assets}
          accounts={accounts}
          readOnly={!canEdit}
          onClose={() => setEditor(null)}
        />
      )}

      {holidaysOpen && (
        <PublicHolidays holidays={holidays} canEdit={canEdit} onClose={() => setHolidaysOpen(false)} />
      )}
    </>
  );
}

function RunStatus({ status }: { status: ScheduleRun["status"] }) {
  const style =
    status === "success" ? "text-success" : status === "running" ? "text-muted" : "font-semibold text-danger";
  return <span className={style}>{status}</span>;
}

// Replaces the Masterdata.Days calendar: dates listed here count as public
// holidays for Daily schedules. Any date not listed is a normal day.
function PublicHolidays({
  holidays,
  canEdit,
  onClose,
}: {
  holidays: PublicHoliday[];
  canEdit: boolean;
  onClose: () => void;
}) {
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function add() {
    setError(null);
    startTransition(async () => {
      const res = await createPublicHoliday(date, name);
      if (res.error) setError(res.error);
      else {
        setDate("");
        setName("");
      }
    });
  }

  function remove(h: PublicHoliday) {
    if (!confirm(`Remove ${h.name}?`)) return;
    startTransition(async () => {
      const res = await deletePublicHoliday(h.id);
      if (res.error) setError(res.error);
    });
  }

  return (
    <Modal open title="Public holidays" width={560} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-muted">
          Daily schedules skip these dates unless they include public holidays. Weekly and monthly schedules ignore
          them.
        </p>
        {canEdit && (
          <div className="flex flex-wrap items-end gap-2">
            <input
              type="date"
              aria-label="Date"
              className={`${inputClass} !w-[160px]`}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <input
              aria-label="Name"
              placeholder="Name, e.g. Heritage Day"
              className={`${inputClass} !w-auto flex-1`}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button type="button" className={primaryButtonClass} disabled={isPending} onClick={add}>
              Add
            </button>
          </div>
        )}
        {error && <p className="border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">{error}</p>}
        <ul className="divide-y divide-border rounded-control border border-border">
          {holidays.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-muted">No public holidays.</li>}
          {holidays.map((h) => (
            <li key={h.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="w-28 text-ink tabular-nums">{formatPlainDate(h.holiday_date)}</span>
              <span className="flex-1 text-ink">{h.name}</span>
              {canEdit && (
                <button type="button" className={dangerLinkButtonClass} disabled={isPending} onClick={() => remove(h)}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}
