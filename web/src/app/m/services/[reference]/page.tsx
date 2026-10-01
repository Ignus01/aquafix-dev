import { notFound } from "next/navigation";
import { SERVICE_TYPE_LABELS } from "@/lib/services/types";
import { getAppTimeZone, getServiceDetail } from "../../../admin/services/actions";
import { shortDate } from "../../format";
import { Header } from "../../ui";

export const metadata = { title: "Service · AquaFix" };

const money = (n: number) => `R ${n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Read-only service card for the field. Completing a service (costs, invoice,
// files) is done in the back office.
export default async function ServicePage(props: PageProps<"/m/services/[reference]">) {
  const { reference } = await props.params;
  const ref = Number(reference);
  if (!Number.isInteger(ref)) notFound();
  const [service, timeZone] = await Promise.all([getServiceDetail(ref), getAppTimeZone()]);
  if (!service) notFound();

  const rows: [string, string][] = [
    ["Asset", `${service.asset.name} (${service.asset.code})`],
    ["Type", SERVICE_TYPE_LABELS[service.service_type]],
    ["Due", shortDate(service.due_date, timeZone)],
    ["Status", service.is_completed ? `Completed ${shortDate(service.completed_date, timeZone)}` : "Open"],
    ["Supplier", service.supplier?.name ?? "—"],
    ["Invoice", service.invoice_nr ?? "—"],
    ["Parts", money(service.total_part_cost)],
    ["Labour", money(service.total_labour_cost)],
    ["Total", money(service.total_cost)],
  ];

  return (
    <>
      <Header title={`Service ${service.reference}`} backHref="/m/services" />
      <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 bg-white px-4 py-4 text-[19px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="font-semibold">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {service.comment && (
        <section className="mt-2 bg-white px-4 py-4">
          <h2 className="mb-1 text-[16px] font-semibold tracking-wide text-[#5b6480] uppercase">Comment</h2>
          <p className="text-[19px] whitespace-pre-line">{service.comment}</p>
        </section>
      )}
      {service.files.length > 0 && (
        <p className="px-4 py-3 text-[16px] text-[#5b6480]">{service.files.length} file(s) attached (view in the back office).</p>
      )}
    </>
  );
}
