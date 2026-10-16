import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { formatDay } from "@/lib/dashboard/format";
import { formatDateTime } from "@/lib/incidents/format";
import { rangeText } from "@/lib/quality/evaluate";
import { QUALITY_READERS, isQualityAdmin } from "@/lib/quality/permissions";
import { PageHeader } from "../../../page-header";
import { getAppTimeZone } from "../../../services/actions";
import { tableHeadCellClass } from "../../../ui";
import { getSample } from "../../actions";
import { ImportFileLink } from "../../file-link";
import { ResultValue, StatusPill } from "../../result-cell";
import { DeleteSampleButton } from "./delete-button";

// One sample: where and when it was taken, and each result against its
// parameter's current limits.
export default async function SamplePage(props: PageProps<"/admin/quality/samples/[id]">) {
  const roles = await requireRole(QUALITY_READERS);
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [data, timeZone] = await Promise.all([getSample(id), getAppTimeZone()]);
  if (!data) notFound();
  const { sample, results } = data;

  const facts: [string, React.ReactNode][] = [
    ["Location", sample.location_name],
    ["Sampled", formatDay(sample.sampled_on)],
    ["Lab no", <span key="no" className="font-mono">{sample.lab_no}</span>],
    ["Lab", sample.lab_name],
    ["Batch", sample.batch_no ?? "—"],
    ["Client", sample.client_name ?? "—"],
    ["Sample type", sample.sample_type ?? "—"],
    ["Lab locality", sample.lab_locality ?? "—"],
    ["File", <ImportFileLink key="file" importId={sample.import_id} fileName={sample.file_name} />],
    [
      "Imported",
      `${formatDateTime(sample.imported_at, timeZone)}${sample.imported_by_name ? ` · ${sample.imported_by_name}` : ""}`,
    ],
  ];

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumb="Quality / Lab Results"
        title={`${sample.location_name} · ${formatDay(sample.sampled_on)}`}
        actions={isQualityAdmin(roles) && <DeleteSampleButton id={sample.id} labNo={sample.lab_no} />}
      />

      <div className="flex flex-col gap-6 px-4 pb-10 md:px-8">
        <Link href="/admin/quality" className="text-[13px] font-semibold text-primary hover:text-primary-hover">
          ← All samples
        </Link>

        <dl className="grid grid-cols-1 gap-x-8 gap-y-3 rounded-card border border-border bg-card p-5 sm:grid-cols-2 lg:grid-cols-3">
          {facts.map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5">
              <dt className="text-xs font-medium text-muted">{label}</dt>
              <dd className="text-sm text-ink">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="overflow-hidden rounded-card border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-table-head">
                  <th className={tableHeadCellClass}>Parameter</th>
                  <th className={`${tableHeadCellClass} !text-right`}>Result</th>
                  <th className={tableHeadCellClass}>Unit</th>
                  <th className={tableHeadCellClass}>Acceptable</th>
                  <th className={tableHeadCellClass}>Status</th>
                  <th className={tableHeadCellClass}>Lab column</th>
                </tr>
              </thead>
              <tbody>
                {results.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted">
                      This sample has no results.
                    </td>
                  </tr>
                )}
                {results.map((r) => (
                  <tr key={r.id} className="h-[44px] border-t border-border">
                    <td className="px-3 text-ink">{r.parameter_name}</td>
                    <td className="px-3 text-right">
                      <ResultValue r={{ ...r, name: r.parameter_name }} />
                    </td>
                    <td className="px-3 text-muted">{r.unit}</td>
                    <td className="px-3 font-mono text-[13px] text-muted">{rangeText(r)}</td>
                    <td className="px-3">
                      <StatusPill status={r.status} />
                    </td>
                    <td className="px-3 text-xs text-muted">
                      {r.lab_parameter}
                      {r.lab_unit ? ` (${r.lab_unit})` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
