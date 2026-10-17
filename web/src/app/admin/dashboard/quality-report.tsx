import Link from "next/link";
import { fmt, formatDay, formatRange, pct } from "@/lib/dashboard/format";
import { rangeText } from "@/lib/quality/evaluate";
import {
  LAB_COLOUR,
  SITE_COLOUR,
  type QualityReading,
  type QualityReport as QualityReportData,
  type ReportParameter,
} from "@/lib/quality/report";
import { ResultValue } from "../quality/result-cell";
import { Card, Empty, Kpi } from "./cards";
import { QualityTrend } from "./quality-trend";

// The home page's Quality tab: lab certificates and on-site inspection
// readings side by side, checked against the same parameter limits
// (public.water_quality_reading). Site readings come from inspections flagged
// as a water quality parameter in Inspection Setup.

const asResult = (r: QualityReading) => ({ ...r, name: r.parameter_name });

const readingHref = (r: QualityReading) =>
  r.source === "lab" ? `/admin/quality/samples/${r.sample_id}` : `/admin/inspections/activities/${r.reference}`;

const readingTitle = (r: QualityReading) =>
  r.source === "lab"
    ? `Lab ${r.reference}, sampled ${formatDay(r.sampled_on)}`
    : `Inspection ${r.reference}${r.asset_name ? ` on ${r.asset_name}` : ""}, ${formatDay(r.sampled_on)}`;

function SourceTag({ source }: { source: "lab" | "site" }) {
  return (
    <span className="inline-flex w-8 shrink-0 items-center gap-1 text-[11px] font-semibold text-muted">
      <span
        aria-hidden="true"
        className={source === "lab" ? "h-2 w-2 rotate-45" : "h-2 w-2 rounded-full"}
        style={{ background: source === "lab" ? LAB_COLOUR : SITE_COLOUR }}
      />
      {source === "lab" ? "Lab" : "Site"}
    </span>
  );
}

function CellReading({ r, source }: { r: QualityReading | undefined; source: "lab" | "site" }) {
  return (
    <div className="flex items-center gap-1.5">
      <SourceTag source={source} />
      {r ? (
        <Link href={readingHref(r)} title={readingTitle(r)} className="hover:underline">
          <ResultValue r={asResult(r)} className="text-[12px]" />
        </Link>
      ) : (
        <span className="text-xs text-muted">—</span>
      )}
    </div>
  );
}

function columnLabel(p: ReportParameter) {
  return p.short_name || p.name;
}

export function QualityReport({
  data,
  from,
  to,
  query,
}: {
  data: QualityReportData;
  from: string;
  to: string;
  query: string;
}) {
  const t = data.totals;

  if (t.readings === 0) {
    return (
      <div className="px-4 pb-10 md:px-8">
        <div className="rounded-card border border-border bg-card px-6 py-10 text-center">
          <p className="text-sm font-semibold text-ink">No water quality readings in this period.</p>
          <p className="mx-auto mt-1 max-w-[520px] text-sm text-muted">
            Lab results appear once certificates are imported under Quality → Import. Site readings appear once an
            inspection is marked as a water quality parameter in Inspection Setup and captured in the field.
          </p>
        </div>
      </div>
    );
  }

  const trendLocation = data.locations.find((l) => l.id === data.trend?.location_id);

  return (
    <>
      <div className="px-4 pt-1 pb-3 text-[13px] text-muted md:px-8">
        <span className="font-semibold text-ink">{formatRange(from, to)}</span>
        {" · "}
        {fmt(t.sites)} {t.sites === 1 ? "site" : "sites"} with readings · {fmt(data.parameters.length)} parameters
      </div>

      <div className="flex flex-col gap-4 px-4 pb-10 md:px-8">
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Key figures">
          <Kpi
            label="Lab samples"
            value={fmt(t.lab_samples)}
            note={`${fmt(t.lab_results)} results · ${fmt(t.lab_out_of_spec)} out of spec`}
            href="/admin/quality"
          />
          <Kpi
            label="Site readings"
            value={fmt(t.site_readings)}
            note={`From ${fmt(t.site_inspections)} ${t.site_inspections === 1 ? "inspection" : "inspections"} · ${fmt(t.site_out_of_spec)} out of spec`}
            href="/admin/inspections?tab=activities"
          />
          <Kpi
            label="Out of spec"
            value={fmt(t.out_of_spec)}
            note={`${pct(t.out_of_spec, t.with_limit, 1)} of ${fmt(t.with_limit)} readings with a limit`}
            tone={t.out_of_spec > 0 ? "danger" : undefined}
          />
          <Kpi
            label="Sites checked both ways"
            value={fmt(t.sites_with_both)}
            note={`of ${fmt(t.sites)} sites have lab and site readings in the period`}
          />
        </section>

        {data.trend && trendLocation && (
          <Card
            title="Trend against the limit"
            caption="One parameter at one site: what the field team measured on each inspection, and what the lab found."
          >
            <QualityTrend
              points={data.trend.points}
              parameter={data.trend.parameter}
              parameters={data.trend.parameters}
              locationId={trendLocation.id}
              locations={data.locations}
              from={from}
              to={to}
              query={query}
            />
          </Card>
        )}

        <section className="rounded-card border border-border bg-card">
          <div className="px-5 pt-4 pb-3">
            <h2 className="text-[15px] font-semibold text-ink">Latest per site</h2>
            <p className="text-[13px] text-muted">
              Each site&rsquo;s latest lab result and latest site reading in the period, per parameter. Parameters
              measured on site come first. Green is within the limit, red out of spec, orange inconclusive.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-0 text-[13px]">
              <thead>
                <tr className="bg-table-head text-left">
                  <th className="sticky left-0 z-10 min-w-[160px] border-b border-border bg-table-head px-4 py-2 text-[11px] font-semibold tracking-wider text-muted uppercase">
                    Site
                  </th>
                  {data.parameters.map((p) => (
                    <th
                      key={p.id}
                      title={`${p.name} · ${p.unit} · limit ${rangeText(p)}`}
                      className="min-w-[118px] border-b border-border px-3 py-2 font-semibold whitespace-nowrap text-ink"
                    >
                      {columnLabel(p)}
                      <span className="block text-[11px] font-normal text-muted">
                        {p.unit} · {rangeText(p)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.locations.map((l) => (
                  <tr key={l.id} className="align-top">
                    <td className="sticky left-0 z-10 border-b border-border bg-card px-4 py-2.5 font-semibold text-ink">
                      {l.name}
                    </td>
                    {data.parameters.map((p) => {
                      const cell = data.matrix[l.id]?.[p.id];
                      return (
                        <td key={p.id} className="border-b border-border px-3 py-2">
                          {cell ? (
                            <div className="flex flex-col gap-1">
                              <CellReading r={cell.lab} source="lab" />
                              <CellReading r={cell.site} source="site" />
                            </div>
                          ) : (
                            <span className="text-xs text-muted">Not measured</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <Card title="Out of spec" caption={`The latest ${data.exceedances.length} readings outside their limit, lab and site.`}>
          {data.exceedances.length === 0 ? (
            <Empty>Every reading with a limit was within it.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] font-semibold tracking-wider text-muted uppercase">
                    <th className="pb-1.5 font-semibold">Date</th>
                    <th className="pb-1.5 font-semibold">Site</th>
                    <th className="pb-1.5 font-semibold">Parameter</th>
                    <th className="pb-1.5 font-semibold">Value</th>
                    <th className="pb-1.5 font-semibold">Limit</th>
                    <th className="pb-1.5 font-semibold">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {data.exceedances.map((r) => (
                    <tr key={r.id} className="border-t border-border/70">
                      <td className="py-1.5 pr-3 whitespace-nowrap">{formatDay(r.sampled_on)}</td>
                      <td className="py-1.5 pr-3">{r.location_name}</td>
                      <td className="py-1.5 pr-3">{r.parameter_name}</td>
                      <td className="py-1.5 pr-3">
                        <ResultValue r={asResult(r)} />
                      </td>
                      <td className="py-1.5 pr-3 font-mono whitespace-nowrap text-muted tabular-nums">
                        {rangeText(r)} {r.unit}
                      </td>
                      <td className="py-1.5">
                        <span className="inline-flex items-center gap-2">
                          <SourceTag source={r.source} />
                          <Link href={readingHref(r)} className="font-semibold text-primary hover:text-primary-hover">
                            {r.source === "lab" ? r.reference : `#${r.reference}`}
                          </Link>
                          {r.asset_name && <span className="text-xs text-muted">{r.asset_name}</span>}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
