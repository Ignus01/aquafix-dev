import Link from "next/link";
import { getCurrentUser, requireRole } from "@/lib/auth";
import { parseGridParams } from "@/lib/grid/params";
import { incidentsGrid } from "@/lib/grid/specs/incidents";
import { INCIDENT_READERS, isIncidentAdmin, isIncidentWriter } from "@/lib/incidents/permissions";
import { PageHeader } from "../page-header";
import { PlusIcon } from "../icons";
import {
  getAppTimeZone,
  listIncidentFilterOptions,
  listIncidentGrid,
  listLocationStatus,
  listOpenDisablingIncidents,
} from "./actions";
import { IncidentsGrid, LocationStatusList } from "./incidents-view";

type TabKey = "mine" | "all" | "locations";

// Incident_Overview (desktop, admins) and Incident_Overview_PWA (field users,
// the "Mine" tab) on one page, plus LocationStatus_Overview as a third tab.
// Each tab loads only its own data.
export default async function IncidentsPage(props: PageProps<"/admin/incidents">) {
  const roles = await requireRole(INCIDENT_READERS);
  const user = await getCurrentUser();
  const searchParams = await props.searchParams;

  const isAdmin = isIncidentAdmin(roles);
  const isWriter = isIncidentWriter(roles);
  const tabs: { key: TabKey; label: string }[] = [
    ...(isWriter && user ? [{ key: "mine" as const, label: "Mine" }] : []),
    { key: "all", label: "All incidents" },
    { key: "locations", label: "Location status" },
  ];
  // Field users start on their own open incidents; admins on everything.
  const defaultTab: TabKey = !isAdmin && isWriter && user ? "mine" : "all";
  const tab = tabs.find((t) => t.key === searchParams.tab)?.key ?? defaultTab;

  const [timeZone, locations] = await Promise.all([getAppTimeZone(), listLocationStatus()]);
  const notOperational = locations.filter((l) => !l.is_operational).length;

  let content: React.ReactNode;
  if (tab === "locations") {
    content = <LocationStatusList locations={locations} incidents={await listOpenDisablingIncidents()} roles={roles} />;
  } else {
    const mine = tab === "mine";
    const params = parseGridParams(searchParams, incidentsGrid);
    const [result, options] = await Promise.all([
      listIncidentGrid(params, timeZone, mine ? (user?.id ?? null) : null),
      listIncidentFilterOptions(),
    ]);
    content = (
      <IncidentsGrid
        result={result}
        params={params}
        options={options}
        roles={roles}
        userId={user?.id ?? null}
        timeZone={timeZone}
        mine={mine}
      />
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumb="Work / Incidents"
        title="Incidents"
        actions={
          isWriter && (
            <Link
              href="/admin/incidents/new"
              className="flex h-[38px] items-center gap-2 rounded-control bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
            >
              <PlusIcon className="h-4 w-4" />
              New incident
            </Link>
          )
        }
      />

      <div className="px-4 pb-10 md:px-8">
        <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((t) => (
            <Link
              key={t.key}
              href={`/admin/incidents?tab=${t.key}`}
              className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold whitespace-nowrap transition-colors ${
                tab === t.key ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink"
              }`}
            >
              {t.label}
              {t.key === "locations" && notOperational > 0 && (
                <span className="rounded-full bg-danger-bg px-2 py-0.5 text-xs text-danger" title="Locations not operational">
                  {notOperational}
                </span>
              )}
            </Link>
          ))}
        </nav>

        {content}
      </div>
    </div>
  );
}
