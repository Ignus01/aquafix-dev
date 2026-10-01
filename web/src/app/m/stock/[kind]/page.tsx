import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUserRoles } from "@/lib/auth";
import { DOC_CONFIG, docNumber, isDocKind } from "@/lib/stock-manager/docs";
import { canDoc } from "@/lib/stock-manager/permissions";
import { getAppTimeZone } from "../../../admin/inspections/actions";
import { getOptions, listDocuments } from "../../../admin/stock-manager/actions";
import { shortDate, shortDateTime } from "../../format";
import { BanIcon, ChevronRightIcon, PlusIcon } from "../../icons";
import { Empty, Header } from "../../ui";

export const metadata = { title: "Stock · AquaFix" };

// The date column of each document type.
const DATE_KEY: Record<string, { key: string; time: boolean }> = {
  loads: { key: "load_date", time: false },
  transfers: { key: "transfer_date", time: true },
  "work-orders": { key: "order_date", time: true },
  "stock-takes": { key: "take_date", time: true },
};

export default async function StockListPage(props: PageProps<"/m/stock/[kind]">) {
  const { kind } = await props.params;
  if (!isDocKind(kind) || !DATE_KEY[kind]) notFound();
  const cfg = DOC_CONFIG[kind];

  const [docs, options, timeZone, roles] = await Promise.all([
    listDocuments(kind),
    getOptions(),
    getAppTimeZone(),
    getCurrentUserRoles(),
  ]);
  const areaName = new Map(options.storageAreas.map((o) => [o.value, o.label]));
  const typeLabel = new Map(options.transferTypes.map((o) => [o.value, o.label]));
  const date = DATE_KEY[kind];

  return (
    <>
      <Header title={kind === "loads" ? "Intakes" : cfg.plural} backHref="/m/stock" />
      <div className="flex-1 bg-white">
        {docs.length === 0 ? (
          <Empty icon={<BanIcon className="h-6 w-6 shrink-0" />}>No {cfg.plural.toLowerCase()} yet</Empty>
        ) : (
          <ul>
            {docs.map((d) => {
              const when = date.time ? shortDateTime(d[date.key], timeZone) : shortDate(d[date.key], timeZone);
              let subtitle = "";
              if (kind === "transfers") {
                subtitle = [
                  typeLabel.get(d.transfer_type) ?? d.transfer_type,
                  [areaName.get(d.from_storage_area_id), areaName.get(d.to_storage_area_id)].filter(Boolean).join(" → "),
                ]
                  .filter(Boolean)
                  .join(" · ");
              } else if (kind === "loads") {
                subtitle = [d.driver, d.vehicle_reg_nr].filter(Boolean).join(" · ");
              } else {
                subtitle = areaName.get(d.storage_area_id) ?? "";
              }
              return (
                <li key={d.id} className="border-b border-[#3b4150]">
                  <Link href={`/m/stock/${kind}/${d.reference}`} className="flex items-center gap-3 px-4 py-3.5 active:bg-black/5">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[21px] font-semibold">{docNumber(kind, d.reference)}</span>
                        <span className="text-[17px]">{when}</span>
                      </div>
                      {subtitle && <div className="truncate text-[17px] text-[#5b6480]">{subtitle}</div>}
                      {d.comment && <div className="truncate text-[17px]">{d.comment}</div>}
                    </div>
                    <ChevronRightIcon className="h-5 w-5 shrink-0" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {canDoc(roles, kind, "create") && (
        <Link
          href={`/m/stock/${kind}/new`}
          className="fixed right-[max(1rem,calc(50%-224px))] bottom-[84px] z-20 flex h-[68px] w-[68px] items-center justify-center rounded-full bg-[#3bb54a] text-[19px] font-medium text-white shadow-lg"
        >
          <PlusIcon className="h-5 w-5" />
          New
        </Link>
      )}
    </>
  );
}
