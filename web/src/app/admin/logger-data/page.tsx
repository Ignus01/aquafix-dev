import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { isoToZonedInput } from "@/lib/inspections/dates";
import { parseReadingFilter } from "@/lib/logger-data/readings";
import { READINGS_PAGE_SIZE } from "@/lib/logger-data/types";
import { PageHeader } from "../page-header";
import { getAppTimeZone } from "../services/actions";
import { listChartPoints, listLoggerAssets, listReadings, listRunResults, listRuns } from "./actions";
import { PullForm } from "./pull-form";
import { ReadingsView } from "./readings-view";
import { RunsView } from "./runs-view";

const TABS = [
  { key: "data", label: "Readings" },
  { key: "pull", label: "Pull data" },
  { key: "runs", label: "Run log" },
] as const;

// Admin → Logger Data (system admins): the readings pulled from the asset
// loggers, a manual pull for a chosen period, and the log of every pull.
export default async function LoggerDataPage(props: PageProps<"/admin/logger-data">) {
  await requireRole(["system_admin"]);
  const params = await props.searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const tab = TABS.find((t) => t.key === one(params.tab))?.key ?? "data";

  const timeZone = await getAppTimeZone();

  let content: React.ReactNode;
  if (tab === "data") {
    const filter = parseReadingFilter(params);
    const requested = Math.max(1, Math.floor(Number(one(params.page)) || 1));
    const [assets, chart, firstTry] = await Promise.all([
      listLoggerAssets(),
      filter.asset ? listChartPoints(filter, timeZone) : null,
      listReadings(filter, requested, timeZone),
    ]);
    // A page past the end (the data shrank, or a stale link) shows the last one.
    const lastPage = Math.max(1, Math.ceil(firstTry.total / READINGS_PAGE_SIZE));
    const page = Math.min(requested, lastPage);
    const { rows, total } = page === requested ? firstTry : await listReadings(filter, page, timeZone);
    content = (
      <ReadingsView
        assets={assets}
        filter={filter}
        rows={rows}
        total={total}
        page={page}
        chart={chart}
        timeZone={timeZone}
      />
    );
  } else if (tab === "pull") {
    const now = new Date();
    content = (
      <PullForm
        assets={await listLoggerAssets()}
        timeZone={timeZone}
        defaultFrom={isoToZonedInput(new Date(now.getTime() - 24 * 3_600_000).toISOString(), timeZone)}
        defaultTo={isoToZonedInput(now.toISOString(), timeZone)}
      />
    );
  } else {
    const runId = Number(one(params.run)) || null;
    const [runs, results] = await Promise.all([listRuns(), runId ? listRunResults(runId) : []]);
    content = <RunsView runs={runs} openRunId={runId} results={results} timeZone={timeZone} />;
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader breadcrumb="Admin / Logger Data" title="Logger Data" />

      <div className="px-4 pb-10 md:px-8">
        <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/admin/logger-data?tab=${t.key}`}
              className={`border-b-2 px-4 py-2.5 text-sm font-semibold whitespace-nowrap transition-colors ${
                tab === t.key ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>

        {content}
      </div>
    </div>
  );
}
