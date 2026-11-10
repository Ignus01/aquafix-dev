"use client";

import Link from "next/link";
import { formatDateTime } from "@/lib/incidents/format";
import { readingsGrid, type ReadingGridRow } from "@/lib/grid/specs/logger";
import type { ChoiceOption, GridParams, GridResult } from "@/lib/grid/types";
import type { ChartPoint } from "@/lib/logger-data/types";
import { Dash, type GridColumn } from "../grid/columns";
import { Grid } from "../grid/grid";
import type { RowMenuItem } from "../grid/row-menu";
import { sectionHeadingClass } from "../ui";
import { LineChart } from "./line-chart";

// Every stored reading, one page at a time from logger_reading_grid (there
// are far too many to load at once). With one asset filtered, its readings
// over the Reading time range are drawn as a chart above the grid.

const formatValue = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 6 });

export function ReadingsView({
  result,
  params,
  options,
  chart,
  timeZone,
}: {
  result: GridResult<ReadingGridRow>;
  params: GridParams;
  options: Record<"asset" | "location", ChoiceOption[]>;
  chart: { assetLabel: string; points: ChartPoint[]; unit: string | null; truncated: boolean } | null;
  timeZone: string;
}) {
  const assetHref = (r: ReadingGridRow) => `/admin/logger-data?tab=data&f.asset=${r.asset_id}`;

  const columns: GridColumn<ReadingGridRow>[] = [
    { key: "id", render: (r) => <span className="font-mono text-[13px]">{r.id}</span> },
    { key: "time", render: (r) => <span className="whitespace-nowrap tabular-nums">{formatDateTime(r.reading_at, timeZone)}</span> },
    { key: "asset", render: (r) => r.asset_name ?? <Dash /> },
    { key: "code", render: (r) => <span className="font-mono text-[13px] text-muted">{r.asset_code ?? "—"}</span> },
    { key: "location", render: (r) => r.location_name ?? <Dash /> },
    { key: "type", render: (r) => r.logger_type },
    { key: "logger", render: (r) => <span className="font-mono text-[13px] text-muted">{r.logger_code}</span> },
    { key: "value", align: "right", render: (r) => <span className="font-mono text-[13px]">{formatValue(Number(r.value))}</span> },
    { key: "unit", render: (r) => r.unit ?? <Dash /> },
    { key: "pulled", render: (r) => <span className="text-muted tabular-nums">{formatDateTime(r.pulled_at, timeZone)}</span> },
  ];

  // Readings aren't edited, so there's no record page: the menu narrows the
  // grid to the reading's asset (with its chart) or copies the reading.
  function menu(r: ReadingGridRow): RowMenuItem[] {
    return [
      { label: "View asset", href: assetHref(r) },
      {
        label: "Copy",
        onSelect: () =>
          navigator.clipboard?.writeText(
            `${r.asset_name ?? r.logger_code}\t${formatDateTime(r.reading_at, timeZone)}\t${r.value}${r.unit ? ` ${r.unit}` : ""}`,
          ),
      },
    ];
  }

  return (
    <div className="flex flex-col gap-6">
      {chart && (
        <section className="rounded-card border border-border bg-card">
          <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-5 py-4 md:px-6">
            <h2 className={sectionHeadingClass}>
              {chart.assetLabel}
              {chart.unit && <span className="normal-case"> · {chart.unit}</span>}
            </h2>
            {chart.truncated && (
              <span className="text-xs text-muted">
                Showing the latest {chart.points.length.toLocaleString("en-US")} readings. Narrow the dates to see
                earlier ones.
              </span>
            )}
          </div>
          <div className="px-5 py-5 md:px-6">
            {chart.points.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted">No readings for this asset in this period.</p>
            ) : (
              <LineChart
                points={chart.points}
                unit={chart.unit}
                timeZone={timeZone}
                ariaLabel={`Readings for ${chart.assetLabel}`}
              />
            )}
          </div>
        </section>
      )}
      {!chart && result.total > 0 && (
        <p className="-mb-3 text-xs text-muted">Filter on one asset to see its readings as a chart.</p>
      )}

      <Grid
        mode="server"
        spec={readingsGrid}
        result={result}
        params={params}
        columns={columns}
        getKey={(r) => String(r.id)}
        title="Readings"
        timeZone={timeZone}
        rowHref={assetHref}
        rowLabel={(r) => `reading ${r.id}`}
        rowMenu={menu}
        options={options}
        emptyLabel="No logger data yet. Readings are pulled daily at 06:00, or from Pull data."
      />
      {result.total === 0 && Object.keys(params.filters).length === 0 && (
        <Link href="/admin/logger-data?tab=pull" className="-mt-3 text-[13px] font-semibold text-primary hover:text-primary-hover">
          Pull data now
        </Link>
      )}
    </div>
  );
}
