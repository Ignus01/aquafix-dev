import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { parseGridParams } from "@/lib/grid/params";
import { openServicesGrid, servicesGrid } from "@/lib/grid/specs/services";
import { SERVICE_READERS, isServiceAdmin, isServiceWriter } from "@/lib/services/permissions";
import { PageHeader } from "../page-header";
import { PlusIcon } from "../icons";
import { getAppTimeZone, listServiceFilterOptions, listServiceGrid } from "./actions";
import { ServicesGrid } from "./services-grid";

const TABS = [
  { key: "open", label: "Open" },
  { key: "all", label: "All services" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

// Service_Overview (the web data grid of all services) and
// Service_Overview_PWA (open services, completed from a phone) on one
// responsive page: the same grid, Open being its open-only preset. Admins
// land on All, field users on Open.
export default async function ServicesPage(props: PageProps<"/admin/services">) {
  const roles = await requireRole(SERVICE_READERS);
  const searchParams = await props.searchParams;

  const isWriter = isServiceWriter(roles);
  const defaultTab: TabKey = isServiceAdmin(roles) || !isWriter ? "all" : "open";
  const tab = TABS.find((t) => t.key === searchParams.tab)?.key ?? defaultTab;
  const open = tab === "open";

  const timeZone = await getAppTimeZone();
  const now = new Date().toISOString();
  const params = parseGridParams(searchParams, open ? openServicesGrid : servicesGrid);
  const [result, options] = await Promise.all([
    listServiceGrid(open, params, timeZone),
    listServiceFilterOptions(),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumb="Work / Services"
        title="Services"
        actions={
          isWriter && (
            <Link
              href="/admin/services/new"
              className="flex h-[38px] items-center gap-2 rounded-control bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
            >
              <PlusIcon className="h-4 w-4" />
              New service
            </Link>
          )
        }
      />

      <div className="px-4 pb-10 md:px-8">
        <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/admin/services?tab=${t.key}`}
              className={`border-b-2 px-4 py-2.5 text-sm font-semibold whitespace-nowrap transition-colors ${
                tab === t.key ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>

        <ServicesGrid
          open={open}
          result={result}
          params={params}
          options={options}
          canEdit={isWriter}
          timeZone={timeZone}
          now={now}
        />
      </div>
    </div>
  );
}
