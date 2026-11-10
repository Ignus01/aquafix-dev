import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { parseGridParams } from "@/lib/grid/params";
import { readingsGrid, runsGrid } from "@/lib/grid/specs/logger";
import { isoToZonedInput } from "@/lib/inspections/dates";
import { PageHeader } from "../page-header";
import { getAppTimeZone } from "../services/actions";
import {
  getRun,
  listChartPoints,
  listLoggerAssets,
  listLoggerUserOptions,
  listReadingFilterOptions,
  listReadingGrid,
  listRunGrid,
  listRunResults,
} from "./actions";
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
  const searchParams = await props.searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const tab = TABS.find((t) => t.key === one(searchParams.tab))?.key ?? "data";

  const timeZone = await getAppTimeZone();

  let content: React.ReactNode;
  if (tab === "data") {
    const params = parseGridParams(searchParams, readingsGrid);
    // One asset filtered: chart it over the Reading time range.
    const assetFilter = params.filters.asset;
    const chartAsset = assetFilter?.kind === "choice" && assetFilter.values.length === 1 ? assetFilter.values[0] : null;
    const time = params.filters.time;
    const range = time?.kind === "datetime" ? { from: time.from, to: time.to } : { from: null, to: null };
    const [assets, result, points] = await Promise.all([
      listLoggerAssets(),
      listReadingGrid(params, timeZone),
      chartAsset ? listChartPoints(chartAsset, range, timeZone) : null,
    ]);
    const options = await listReadingFilterOptions(assets);
    const selected = assets.find((a) => a.id === chartAsset);
    content = (
      <ReadingsView
        result={result}
        params={params}
        options={options}
        chart={points && selected ? { assetLabel: `${selected.name} · ${selected.logger_code}`, ...points } : null}
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
    const params = parseGridParams(searchParams, runsGrid);
    const runId = Number(one(searchParams.run)) || null;
    const [result, userOptions, openRun, results] = await Promise.all([
      listRunGrid(params, timeZone),
      listLoggerUserOptions(),
      runId ? getRun(runId) : null,
      runId ? listRunResults(runId) : [],
    ]);
    content = (
      <RunsView
        result={result}
        params={params}
        userOptions={userOptions}
        openRun={openRun}
        results={results}
        timeZone={timeZone}
      />
    );
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
