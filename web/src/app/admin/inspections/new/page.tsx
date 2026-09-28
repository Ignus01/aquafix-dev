import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { formatDate } from "@/lib/incidents/format";
import { INSPECTION_WRITERS } from "@/lib/inspections/permissions";
import { ChevronLeftIcon, ChevronRightIcon } from "../../icons";
import { PageHeader } from "../../page-header";
import { getAppTimeZone, listInspectionLocations, listLocationAssets } from "../actions";

// The ad-hoc path (IAC-R02): Inspection_SelectLocation, then
// Inspection_SelectAsset (?location=…). Picking an asset opens the capture
// page; nothing is created until it's saved.
export default async function NewInspectionPage(props: PageProps<"/admin/inspections/new">) {
  await requireRole(INSPECTION_WRITERS);
  const { location: locationParam } = await props.searchParams;
  const locationId = typeof locationParam === "string" ? locationParam : null;

  if (!locationId) {
    const locations = await listInspectionLocations();
    return (
      <div className="flex flex-1 flex-col">
        <PageHeader breadcrumb="Inspections / New inspection" title="Select a location" />
        <div className="px-4 pb-10 md:px-8">
          <BackLink href="/admin/inspections" label="Inspections" />
          {locations.length === 0 ? (
            <Empty>There are no active asset-manager locations.</Empty>
          ) : (
            <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {locations.map((l) => (
                <Link
                  key={l.id}
                  href={`/admin/inspections/new?location=${l.id}`}
                  className="flex items-center gap-3 rounded-card border border-border bg-card p-4 transition-colors hover:bg-row-hover"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-ink">{l.name}</div>
                    <div className="text-[13px] text-muted">
                      {l.asset_count} asset{l.asset_count === 1 ? "" : "s"}
                    </div>
                  </div>
                  <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted" />
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const [{ location, assets }, timeZone] = await Promise.all([listLocationAssets(locationId), getAppTimeZone()]);

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader breadcrumb="Inspections / New inspection" title={location?.name ?? "Select an asset"} />
      <div className="px-4 pb-10 md:px-8">
        <BackLink href="/admin/inspections/new" label="Locations" />
        {!location ? (
          <Empty>That location no longer exists.</Empty>
        ) : assets.length === 0 ? (
          <Empty>{location.name} Does Not Have Any Assets</Empty>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {assets.map((a) => (
              <Link
                key={a.id}
                href={`/admin/inspections/capture?asset=${a.id}`}
                className="flex items-center gap-3 rounded-card border border-border bg-card p-4 transition-colors hover:bg-row-hover"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold tracking-wider text-muted uppercase">{a.asset_type.name}</div>
                  <div className="truncate font-semibold text-ink">{a.name}</div>
                  <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
                    <span className="font-mono">{a.code}</span>
                    <span>Prev. insp. {a.last_inspection_date ? formatDate(a.last_inspection_date, timeZone) : "—"}</span>
                  </div>
                </div>
                <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted" />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="mb-4 inline-flex items-center gap-1 text-[13px] font-medium text-muted hover:text-ink">
      <ChevronLeftIcon className="h-4 w-4" />
      {label}
    </Link>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-border bg-card px-4 py-10 text-center text-sm text-muted">{children}</div>
  );
}
