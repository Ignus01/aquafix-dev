"use client";

import { Fragment, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/incidents/format";
import type { PullResult, PullResultStatus, PullRun, PullRunStatus } from "@/lib/logger-data/types";
import { ChevronRightIcon } from "../icons";
import { tableHeadCellClass } from "../ui";

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

const RUN_STATUS: Record<PullRunStatus, { tone: Tone; label: string }> = {
  running: { tone: "warning", label: "Running" },
  success: { tone: "success", label: "Done" },
  partial: { tone: "warning", label: "Some failed" },
  failed: { tone: "danger", label: "Failed" },
  no_loggers: { tone: "muted", label: "No loggers" },
};

const RESULT_STATUS: Record<PullResultStatus, { tone: Tone; label: string }> = {
  pending: { tone: "muted", label: "Waiting" },
  running: { tone: "warning", label: "Pulling" },
  success: { tone: "success", label: "Done" },
  failed: { tone: "danger", label: "Failed" },
};

// Each daily or manual pull with how its loggers went. A run opens to show
// every logger's result; while anything is still running the page refreshes
// itself.
export function RunsView({
  runs,
  openRunId,
  results,
  timeZone,
}: {
  runs: PullRun[];
  openRunId: number | null;
  results: PullResult[];
  timeZone: string;
}) {
  const router = useRouter();
  const running = runs.some((r) => r.status === "running");

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [running, router]);

  if (runs.length === 0) {
    return (
      <p className="rounded-card border border-border bg-card px-5 py-10 text-center text-sm text-muted">
        No pulls yet. The first daily pull runs at 06:00.
      </p>
    );
  }

  return (
    <section className="rounded-card border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-table-head">
              <th className={`${tableHeadCellClass} !px-5`}>Started</th>
              <th className={tableHeadCellClass}>Type</th>
              <th className={tableHeadCellClass}>Period</th>
              <th className={tableHeadCellClass}>Status</th>
              <th className={`${tableHeadCellClass} text-right`}>Loggers</th>
              <th className={`${tableHeadCellClass} text-right`}>Failed</th>
              <th className={`${tableHeadCellClass} text-right`}>Readings</th>
              <th className={tableHeadCellClass}>Finished</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => {
              const open = run.id === openRunId;
              const status = RUN_STATUS[run.status];
              return (
                <Fragment key={run.id}>
                  <tr className={`border-t border-border ${open ? "bg-row-hover" : "hover:bg-row-hover"}`}>
                    <td className="px-5 py-2.5 whitespace-nowrap">
                      <Link
                        href={open ? "/admin/logger-data?tab=runs" : `/admin/logger-data?tab=runs&run=${run.id}`}
                        scroll={false}
                        aria-expanded={open}
                        className="inline-flex items-center gap-1.5 font-medium text-ink hover:text-primary"
                      >
                        <ChevronRightIcon className={`h-3.5 w-3.5 text-muted transition-transform ${open ? "rotate-90" : ""}`} />
                        {formatDateTime(run.created_at, timeZone)}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 text-ink">
                      {run.trigger === "cron" ? "Daily" : "Manual"}
                      {run.trigger === "manual" && (
                        <span className="block text-xs text-muted">
                          {run.requested_by_name ?? "—"}
                          {run.asset_count !== null && ` · ${run.asset_count} asset${run.asset_count === 1 ? "" : "s"}`}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-muted tabular-nums">
                      {formatDateTime(run.range_start, timeZone)} – {formatDateTime(run.range_end, timeZone)}
                    </td>
                    <td className="px-3 py-2.5">
                      <Pill tone={status.tone}>
                        {status.label}
                        {run.status === "running" && ` · ${run.loggers - run.pending}/${run.loggers}`}
                      </Pill>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-[13px] text-muted tabular-nums">{run.loggers}</td>
                    <td className={`px-3 py-2.5 text-right font-mono text-[13px] tabular-nums ${run.failed ? "text-danger" : "text-muted"}`}>
                      {run.failed}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-[13px] text-muted tabular-nums">
                      {run.readings_saved.toLocaleString("en-US")}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-muted tabular-nums">
                      {run.finished_at ? formatDateTime(run.finished_at, timeZone) : "—"}
                    </td>
                  </tr>
                  {open && (
                    <tr className="border-t border-border bg-page/60">
                      <td colSpan={8} className="px-5 py-4">
                        <RunResults results={results} timeZone={timeZone} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="border-t border-border px-5 py-3 text-xs text-muted">Showing the latest 100 pulls.</p>
    </section>
  );
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
