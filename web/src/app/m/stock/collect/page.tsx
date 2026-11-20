import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { docNumber } from "@/lib/stock-manager/docs";
import { STOCK_DOC_RIGHTS } from "@/lib/stock-manager/permissions";
import { getOptions, listCollectable } from "../../../admin/stock-manager/actions";
import { formatQty } from "../../../admin/stock-manager/format";
import { BanIcon, ChevronRightIcon } from "../../icons";
import { Empty, Header } from "../../ui";
import { AutoRefresh } from "./auto-refresh";

export const metadata = { title: "Collect · AquaFix" };

// MWTS spec R3: open purchase orders to collect — the ones the office
// assigned to me first, then the unassigned ones any technician can collect.
export default async function CollectListPage() {
  await requireRole(STOCK_DOC_RIGHTS.intakes.create);
  const [orders, options] = await Promise.all([listCollectable(), getOptions()]);
  const itemName = new Map(options.items.map((o) => [o.value, o.label]));
  const areaName = new Map(options.storageAreas.map((o) => [o.value, o.label]));
  const sorted = [...orders].sort((a, b) => Number(b.assigned_to_me) - Number(a.assigned_to_me) || a.reference - b.reference);

  return (
    <>
      <Header title="Collect" backHref="/m/stock" />
      <AutoRefresh />
      <div className="flex-1 bg-white">
        {sorted.length === 0 ? (
          <Empty icon={<BanIcon className="h-6 w-6 shrink-0" />}>Nothing to collect</Empty>
        ) : (
          <ul>
            {sorted.map((po) => {
              const from =
                po.collect_from === "STORAGE_AREA"
                  ? areaName.get(po.collect_from_area_id ?? "") ?? "a storage area"
                  : po.supplier_name;
              return (
                <li key={po.id} className="border-b border-[#e6e8f0]">
                  <Link href={`/m/stock/collect/${po.reference}`} className="flex items-center gap-3 px-4 py-3.5 active:bg-[#eef0fb]">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-[21px] font-semibold">{docNumber("purchase-orders", po.reference)}</span>
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-0.5 text-[14px] font-semibold ${
                            po.assigned_to_me ? "bg-[#e6f4e8] text-[#1f7a2e]" : "bg-[#eef0fb] text-[#3b4aa8]"
                          }`}
                        >
                          {po.assigned_to_me ? "For you" : "Anyone"}
                        </span>
                      </div>
                      <div className="truncate text-[17px] text-[#5b6480]">
                        From {from}
                        {po.order_alias ? ` · ${po.order_alias}` : ""}
                      </div>
                      <div className="truncate text-[17px]">
                        {po.lines.map((l) => `${formatQty(l.qty_outstanding)} × ${itemName.get(l.item_id) ?? "—"}`).join(", ")}
                      </div>
                    </div>
                    <ChevronRightIcon className="h-5 w-5 shrink-0" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
