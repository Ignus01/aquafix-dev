import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { DOC_CONFIG, type DocKind } from "@/lib/stock-manager/docs";
import { STOCK_READERS, canDoc } from "@/lib/stock-manager/permissions";
import { PageHeader } from "../page-header";
import { PlusIcon } from "../icons";
import { inputClass, secondaryButtonClass } from "../ui";
import { getAppTimeZone } from "../services/actions";
import { getOptions, listDocuments, listStock, listTransactions } from "./actions";
import { DocList, StockSummary, Transactions } from "./lists";

const TABS: { key: string; label: string; kind?: DocKind }[] = [
  { key: "summary", label: "Stock summary" },
  { key: "purchase-orders", label: "Purchase orders", kind: "purchase-orders" },
  { key: "loads", label: "Loads", kind: "loads" },
  { key: "intakes", label: "Intakes", kind: "intakes" },
  { key: "transfers", label: "Transfers", kind: "transfers" },
  { key: "work-orders", label: "Work orders", kind: "work-orders" },
  { key: "stock-takes", label: "Stock takes", kind: "stock-takes" },
  { key: "transactions", label: "Transactions" },
];

// Stock manager: stock on hand (the sum of the ledger) and the documents that
// move it. Tabs a role can't read are left out.
export default async function StockManagerPage(props: PageProps<"/admin/stock-manager">) {
  const roles = await requireRole(STOCK_READERS);
  const params = await props.searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const tabs = TABS.filter((t) => !t.kind || canDoc(roles, t.kind, "read"));
  const tab = tabs.find((t) => t.key === one(params.tab)) ?? tabs[0];

  const [options, timeZone] = await Promise.all([getOptions(), getAppTimeZone()]);
  const kind = tab.kind;
  // Intakes are created from a load, so only the others get a New button.
  const canCreate = kind && kind !== "intakes" && canDoc(roles, kind, "create");

  const itemFilter = one(params.item) ?? "";
  const areaFilter = one(params.area) ?? "";

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumb="Stock / Stock Manager"
        title="Stock Manager"
        actions={
          canCreate && (
            <Link
              href={`/admin/stock-manager/${kind}/new`}
              className="flex h-[38px] items-center gap-2 rounded-control bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
            >
              <PlusIcon className="h-4 w-4" />
              New {DOC_CONFIG[kind].label.toLowerCase()}
            </Link>
          )
        }
      />

      <div className="px-4 pb-10 md:px-8">
        <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={`/admin/stock-manager?tab=${t.key}`}
              className={`border-b-2 px-4 py-2.5 text-sm font-semibold whitespace-nowrap transition-colors ${
                tab.key === t.key ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>

        {tab.key === "summary" && <StockSummary rows={await listStock()} />}

        {tab.key === "transactions" && (
          <>
            <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
              <input type="hidden" name="tab" value="transactions" />
              <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                Item
                <select name="item" defaultValue={itemFilter} className={`${inputClass} min-w-56`}>
                  <option value="">All items</option>
                  {options.items.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                Storage area
                <select name="area" defaultValue={areaFilter} className={`${inputClass} min-w-56`}>
                  <option value="">All storage areas</option>
                  {options.storageAreas.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className={secondaryButtonClass}>
                Filter
              </button>
            </form>
            <Transactions
              rows={await listTransactions({ item: itemFilter, area: areaFilter })}
              options={options}
              timeZone={timeZone}
            />
            <p className="mt-2 text-xs text-muted">Showing the latest 300 movements.</p>
          </>
        )}

        {kind && <DocList kind={kind} rows={await listDocuments(kind)} options={options} timeZone={timeZone} />}
      </div>
    </div>
  );
}
