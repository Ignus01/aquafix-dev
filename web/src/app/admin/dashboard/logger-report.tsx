import Link from "next/link";
import { formatDateTime } from "@/lib/incidents/format";
import { BAND_COLOURS, SERIES_COLOUR, bucketLabel, bucketTitle, fmt, formatDay, formatRange } from "@/lib/dashboard/format";
import type { DashboardLogger, LoggerDashboard, LoggerStatus } from "@/lib/dashboard/types";
import { BarList, ColumnChart, Legend, SegmentBar } from "./charts";
import { Card, Empty, Kpi, TONE_PILL, delta } from "./cards";
import {
  LONG_GAP_HOURS,
  STATUS_COLOURS,
  STATUS_LABELS,
  completeness,
  formatGap,
  formatValue,
  isFlat,
  readingsHref,
} from "./logger-format";
import { LoggersTable } from "./loggers-table";

// Home → Loggers (system admins): are the loggers reporting, how complete is
// their data, is the daily pull healthy, and what did each logger measure.
// Every figure comes from public.logger_dashboard().

const RUN_STATUS: Record<
  NonNullable<LoggerDashboard["latest_run"]>["status"],
  { label: string; tone?: "warning" | "danger" }
> = {
  success: { label: "Succeeded" },
  partial: { label: "Partly failed", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
  running: { label: "Running" },
  no_loggers: { label: "No loggers" },
};

const STATUSES: LoggerStatus[] = ["ok", "silent", "never", "inactive"];

type Issue = { text: string; tone: keyof typeof TONE_PILL };

// What needs a look on one logger, worst first.
function issuesOf(l: DashboardLogger, timeZone: string): Issue[] {
  const issues: Issue[] = [];
  if (l.status === "never") issues.push({ text: "Never reported", tone: "danger" });
  if (l.status === "silent") issues.push({ text: `Silent since ${formatDateTime(l.last_at, timeZone)}`, tone: "danger" });
  if (l.pulls_failed > 0)
    issues.push({ text: `${l.pulls_failed} failed ${l.pulls_failed === 1 ? "pull" : "pulls"}`, tone: "danger" });
  if ((l.longest_gap_hours ?? 0) >= LONG_GAP_HOURS)
    issues.push({ text: `Gap of ${formatGap(l.longest_gap_hours)}`, tone: "warning" });
  if (isFlat(l)) issues.push({ text: `Flat at ${formatValue(l.min)}${l.unit ? ` ${l.unit}` : ""}`, tone: "warning" });
  if (l.zeros > 0) issues.push({ text: `${fmt(l.zeros)} zero ${l.zeros === 1 ? "reading" : "readings"}`, tone: "neutral" });
  return issues;
}

export function LoggerReport({ data: d, timeZone }: { data: LoggerDashboard; timeZone: string }) {
  const bucket = d.period.bucket;
  const series = d.series;
  const cov = completeness(d.readings);
  const notReporting = d.scope.silent + d.scope.never;
  const run = d.latest_run;
  const runStatus = run ? RUN_STATUS[run.status] : null;

  const statusCounts = STATUSES.map((s) => ({ status: s, count: d.loggers.filter((l) => l.status === s).length }));
  const leastComplete = d.loggers
    .filter((l) => l.status !== "inactive" && l.days_with_data < l.days_expected)
    .sort((a, b) => (completeness(a) ?? 0) - (completeness(b) ?? 0) || a.name.localeCompare(b.name))
    .slice(0, 6);
  const exceptions = d.loggers
    .filter((l) => l.status !== "inactive")
    .map((l) => ({ logger: l, issues: issuesOf(l, timeZone) }))
    .filter((x) => x.issues.length > 0)
    .sort(
      (a, b) =>
        b.issues.filter((i) => i.tone === "danger").length - a.issues.filter((i) => i.tone === "danger").length ||
        b.issues.length - a.issues.length ||
        a.logger.name.localeCompare(b.logger.name),
    );

  return (
    <>
      <div className="px-4 pt-1 pb-3 text-[13px] text-muted md:px-8">
        <span className="font-semibold text-ink">{formatRange(d.period.from, d.period.to)}</span>
        {" · "}
        {fmt(d.scope.loggers)} active {d.scope.loggers === 1 ? "logger" : "loggers"}
        {" · "}compared with the previous {d.period.days} days
      </div>

      <div className="flex flex-col gap-4 px-4 pb-10 md:px-8">
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Key figures">
          <Kpi
            label="Loggers reporting"
            value={`${fmt(d.scope.ok)} / ${fmt(d.scope.loggers)}`}
            note={`${fmt(d.scope.silent)} silent for 48 hours or more · ${fmt(d.scope.never)} never reported`}
            flag={
              notReporting > 0
                ? { text: `${fmt(notReporting)} not reporting`, tone: "danger" }
                : d.scope.loggers > 0
                  ? { text: "All reporting", tone: "success" }
                  : undefined
            }
            tone={notReporting > 0 ? "danger" : undefined}
            href="/admin/logger-data"
          />
          <Kpi
            label="Readings received"
            value={fmt(d.readings.count)}
            delta={delta(d.readings.count, d.readings.prev, true)}
            note={`from ${fmt(d.scope.reporting)} ${d.scope.reporting === 1 ? "logger" : "loggers"} in the period`}
            trend={series.map((p) => p.readings)}
          />
          <Kpi
            label="Data completeness"
            value={cov === null ? "—" : `${(cov * 100).toFixed(1)}%`}
            note={`${fmt(d.readings.days_with_data)} of ${fmt(d.readings.days_expected)} logger-days had readings, up to ${formatDay(d.period.last_day)}`}
            tone={cov !== null && cov < 0.9 ? "warning" : undefined}
            trend={series.map((p) => (d.scope.loggers ? (p.loggers / d.scope.loggers) * 100 : null))}
          />
          <Kpi
            label="Latest daily pull"
            value={runStatus?.label ?? "None yet"}
            note={
              run
                ? `${formatDateTime(run.created_at, timeZone)} · ${fmt(run.succeeded)} of ${fmt(run.loggers)} loggers · ${fmt(run.readings_saved)} readings`
                : "The daily pull runs at 06:00."
            }
            flag={
              d.pulls.failed > 0
                ? {
                    text: `${fmt(d.pulls.failed)} failed ${d.pulls.failed === 1 ? "pull" : "pulls"} in the period`,
                    tone: "danger",
                  }
                : d.pulls.succeeded > 0
                  ? { text: "No failed pulls in the period", tone: "success" }
                  : undefined
            }
            tone={runStatus?.tone}
            href="/admin/logger-data?tab=runs"
          />
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.55fr_1fr]">
          <Card
            title="Readings received"
            caption={`Readings per ${bucket}, across every logger in scope.`}
          >
            <ColumnChart
              ariaLabel="Logger readings per period"
              height={250}
              labelPeak
              data={series.map((p) => ({
                label: bucketLabel(p.bucket, bucket),
                title: bucketTitle(p.bucket, bucket),
                values: { n: p.readings },
                extra: [{ label: "Loggers reporting", value: `${fmt(p.loggers)} of ${fmt(d.scope.loggers)}` }],
              }))}
              series={[{ key: "n", label: "Readings", colour: SERIES_COLOUR }]}
            />
            <p className="mt-3 text-right text-xs text-muted">
              {bucket !== "day" && `First and last ${bucket}s may be partial. `}
              {d.period.to >= d.period.today && "Today’s readings arrive with tomorrow’s 06:00 pull."}
            </p>
          </Card>

          <Card title="Logger health" caption="Every logger in scope, by whether it is reporting now.">
            {d.loggers.length === 0 ? (
              <Empty>No loggers match these filters.</Empty>
            ) : (
              <>
                <SegmentBar
                  ariaLabel="Loggers by status"
                  segments={statusCounts.map((s) => ({
                    key: s.status,
                    label: STATUS_LABELS[s.status],
                    value: s.count,
                    colour: STATUS_COLOURS[s.status],
                  }))}
                />
                <div className="mt-2">
                  <Legend
                    items={statusCounts
                      .filter((s) => s.count > 0 || s.status !== "inactive")
                      .map((s) => ({
                        label: STATUS_LABELS[s.status],
                        colour: STATUS_COLOURS[s.status],
                        value: fmt(s.count),
                      }))}
                  />
                </div>
                <h3 className="mt-5 mb-2.5 text-[11px] font-semibold tracking-wider text-muted uppercase">
                  Least complete
                </h3>
                {leastComplete.length === 0 ? (
                  <Empty>Every logger has readings for every day.</Empty>
                ) : (
                  <BarList
                    max={100}
                    colour={BAND_COLOURS.warning}
                    unit="percent"
                    rows={leastComplete.map((l) => ({
                      label: l.name,
                      value: (completeness(l) ?? 0) * 100,
                      href: readingsHref(l.id, d.period.from, d.period.to),
                      note: `${l.days_with_data}/${l.days_expected} d`,
                    }))}
                  />
                )}
              </>
            )}
          </Card>
        </section>

        <section className="min-w-0 rounded-card border border-border bg-card">
          <div className="flex flex-wrap items-baseline justify-between gap-3 px-5 pt-4 pb-3">
            <div>
              <h2 className="text-[15px] font-semibold text-ink">Needs attention</h2>
              <p className="text-[13px] text-muted">
                Loggers that are silent or never reported, failed pulls, gaps of a day or more, flat lines (likely a
                stuck sensor) and zero readings.
              </p>
            </div>
            <Link
              href="/admin/logger-data?tab=runs"
              className="shrink-0 text-xs font-semibold text-primary hover:text-primary-hover"
            >
              Run log
            </Link>
          </div>
          {exceptions.length === 0 ? (
            <Empty>{d.loggers.length ? "Nothing needs attention." : "No loggers match these filters."}</Empty>
          ) : (
            <ul>
              {exceptions.slice(0, 10).map(({ logger: l, issues }) => (
                <li key={l.id} className="border-t border-border">
                  <Link
                    href={readingsHref(l.id, d.period.from, d.period.to)}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3 hover:bg-row-hover"
                  >
                    <div className="min-w-[12rem] flex-1">
                      <div className="truncate text-sm font-semibold text-ink">{l.name}</div>
                      <div className="text-xs text-muted">
                        {l.logger_code} · {l.location}
                        {l.last_error && l.pulls_failed > 0 && <> · {l.last_error}</>}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {issues.map((i) => (
                        <span
                          key={i.text}
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${TONE_PILL[i.tone]}`}
                        >
                          {i.text}
                        </span>
                      ))}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {exceptions.length > 10 && (
            <p className="border-t border-border px-5 py-3 text-center text-xs text-muted">
              {exceptions.length - 10} more in the table below
            </p>
          )}
        </section>

        <section className="min-w-0 rounded-card border border-border bg-card">
          <div className="px-5 pt-4 pb-3">
            <h2 className="text-[15px] font-semibold text-ink">Loggers</h2>
            <p className="text-[13px] text-muted">
              Values are per logger, in its own unit; the trend is the average per {bucket}. Open a logger for its
              readings.
            </p>
          </div>
          <LoggersTable loggers={d.loggers} from={d.period.from} to={d.period.to} timeZone={timeZone} />
        </section>
      </div>
    </>
  );
}
