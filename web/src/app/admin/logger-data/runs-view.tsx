"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/incidents/format";
import { SYSTEM_OPTION } from "@/lib/grid/fields";
import { RUN_STATUS_LABELS, runsGrid, type RunGridRow } from "@/lib/grid/specs/logger";
import type { ChoiceOption, GridParams, GridResult } from "@/lib/grid/types";
import type { PullResult, PullResultStatus, PullRunStatus } from "@/lib/logger-data/types";
import { changedColumns, Dash, type GridColumn } from "../grid/columns";
import { Grid } from "../grid/grid";
import type { RowMenuItem } from "../grid/row-menu";
import { XIcon } from "../icons";
import { sectionHeadingClass, tableHeadCellClass } from "../ui";

type Tone = "success" | "danger" | "warning" | "muted";

const toneClass: Record<Tone, string> = {
  success: "bg-success-bg text-success",
  danger: "bg-danger-bg text-danger",
  warning: "bg-warning-bg text-warning",
  muted: "bg-black/[.04] text-muted",
};

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${toneClass[tone]}`}>
      {children}
    </span>
  );
}

const RUN_TONE: Record<PullRunStatus, Tone> = {
  running: "warning",
  success: "success",
  partial: "warning",
  failed: "danger",
  no_loggers: "muted",
};

const RESULT_STATUS: Record<PullResultStatus, { tone: Tone; label: string }> = {
  pending: { tone: "muted", label: "Waiting" },
  running: { tone: "warning", label: "Pulling" },
  success: { tone: "success", label: "Done" },
  failed: { tone: "danger", label: "Failed" },
};

// Each daily or manual pull, one page at a time from logger_pull_run_grid.
// A run's ID opens its loggers' results above the grid; while a run on the
// page (or the open one) is still running, the page refreshes itself.
export function RunsView({
  result,
  params,
  userOptions,
  openRun,
  results,
  timeZone,
}: {
  result: GridResult<RunGridRow>;
  params: GridParams;
  userOptions: ChoiceOption[];
  openRun: RunGridRow | null;
  results: PullResult[];
  timeZone: string;
}) {
  const router = useRouter();
  const running = result.rows.some((r) => r.status === "running") || openRun?.status === "running";

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [running, router]);

  const runHref = (r: RunGridRow) => `/admin/logger-data?tab=runs&run=${r.id}`;
  const num = (v: number, danger = false) => (
    <span className={`font-mono text-[13px] tabular-nums ${danger && v ? "text-danger" : "text-muted"}`}>
      {v.toLocaleString("en-US")}
    </span>
  );

  const columns: GridColumn<RunGridRow>[] = [
    { key: "id", render: (r) => r.id },
    { key: "started", render: (r) => <span className="whitespace-nowrap tabular-nums">{formatDateTime(r.created_at, timeZone)}</span> },
    {
      key: "trigger",
      render: (r) => (
        <>
          {r.trigger === "cron" ? "Daily" : "Manual"}
          {r.asset_count !== null && (
            <span className="block text-xs text-muted">
              {r.asset_count} asset{r.asset_count === 1 ? "" : "s"}
            </span>
          )}
        </>
      ),
    },
    {
      key: "period",
      render: (r) => (
        <span className="whitespace-nowrap text-muted tabular-nums">
          {formatDateTime(r.range_start, timeZone)} – {formatDateTime(r.range_end, timeZone)}
        </span>
      ),
    },
    {
      key: "status",
      render: (r) => (
        <Pill tone={RUN_TONE[r.status]}>
          {RUN_STATUS_LABELS[r.status]}
          {r.status === "running" && ` · ${r.loggers - r.pending}/${r.loggers}`}
        </Pill>
      ),
    },
    { key: "loggers", align: "right", render: (r) => num(r.loggers) },
    { key: "failed", align: "right", render: (r) => num(r.failed, true) },
    { key: "readings", align: "right", render: (r) => num(r.readings_saved) },
    {
      key: "finished",
      render: (r) => (r.finished_at ? <span className="text-muted tabular-nums">{formatDateTime(r.finished_at, timeZone)}</span> : <Dash />),
    },
    ...changedColumns<RunGridRow>(timeZone),
  ];

  function menu(r: RunGridRow): RowMenuItem[] {
    return [
      { label: "Show results", href: runHref(r) },
      ...(r.readings_saved > 0 ? [{ label: "Readings in this period", href: readingsHref(r, timeZone) }] : []),
    ];
  }

  return (
    <div className="flex flex-col gap-6">
      {openRun && (
        <section className="rounded-card border border-border bg-card">
          <div className="flex items-center justify-between gap-2 border-b border-border px-5 py-3 md:px-6">
            <h2 className={sectionHeadingClass}>
              Run {openRun.id} · {formatDateTime(openRun.created_at, timeZone)}
            </h2>
            <Link
              href="/admin/logger-data?tab=runs"
              scroll={false}
              aria-label="Close run results"
              className="rounded-control p-1 text-muted hover:bg-black/[.04] hover:text-ink"
            >
              <XIcon className="h-4 w-4" />
            </Link>
          </div>
          <div className="px-5 py-4 md:px-6">
            <RunResults results={results} timeZone={timeZone} />
          </div>
        </section>
      )}
      <Grid
        mode="server"
        spec={runsGrid}
        result={result}
        params={params}
        columns={columns}
        getKey={(r) => String(r.id)}
        title="Run log"
        timeZone={timeZone}
        rowHref={runHref}
        rowLabel={(r) => `run ${r.id}`}
        rowMenu={menu}
        options={{ changed_by: [...userOptions, SYSTEM_OPTION] }}
        emptyLabel="No pulls yet. The first daily pull runs at 06:00."
      />
    </div>
  );
}

// The readings grid over a run's period (whole days in the app time zone).
function readingsHref(r: RunGridRow, timeZone: string) {
  const day = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(iso));
  return `/admin/logger-data?tab=data&f.time=${day(r.range_start)}..${day(r.range_end)}`;
}

function RunResults({ results, timeZone }: { results: PullResult[]; timeZone: string }) {
  if (results.length === 0) {
    return <p className="text-sm text-muted">No active Hydrus loggers were found for this pull.</p>;
  }
  return (
    <div className="overflow-x-auto rounded-control border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-table-head">
            <th className={`${tableHeadCellClass} !px-4`}>Asset</th>
            <th className={tableHeadCellClass}>Logger</th>
            <th className={tableHeadCellClass}>Status</th>
            <th className={`${tableHeadCellClass} text-right`}>Readings</th>
            <th className={tableHeadCellClass}>Unit</th>
            <th className={tableHeadCellClass}>Message</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => {
            const status = RESULT_STATUS[r.status];
            const retrying = r.status === "pending" && r.attempts > 0;
            return (
              <tr key={r.id} className="border-t border-border align-top">
                <td className="px-4 py-2 text-ink">{r.asset_name ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-[13px] text-muted">{r.logger_code}</td>
                <td className="px-3 py-2">
                  <Pill tone={retrying ? "warning" : status.tone}>
                    {retrying ? `Retrying ${formatDateTime(r.next_attempt_at, timeZone).split(", ")[1]}` : status.label}
                    {r.attempts > 1 && !retrying && ` · ${r.attempts} tries`}
                  </Pill>
                </td>
                <td className="px-3 py-2 text-right font-mono text-[13px] text-muted tabular-nums">
                  {r.readings_saved ?? "—"}
                </td>
                <td className="px-3 py-2 text-muted">{r.unit ?? "—"}</td>
                <td className={`px-3 py-2 text-[13px] ${r.status === "failed" ? "text-danger" : "text-muted"}`}>
                  {r.error ?? "—"}
                  {r.http_status && r.http_status !== 200 && r.status === "failed" ? ` (HTTP ${r.http_status})` : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
