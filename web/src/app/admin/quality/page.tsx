import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { todayInZone } from "@/lib/inspections/dates";
import { filterParams, parseImportIds, parseQualityFilter } from "@/lib/quality/filter";
import { QUALITY_READERS, isQualityAdmin } from "@/lib/quality/permissions";
import { PageHeader } from "../page-header";
import { UploadIcon } from "../icons";
import { getAppTimeZone } from "../services/actions";
import { getLocationGrid, listFilterOptions, listImports, listSamples } from "./actions";
import { QualityFilters } from "./filters";
import { ImportsTable } from "./imports-table";
import { LocationGrid } from "./location-grid";
import { SamplesTable } from "./samples-table";

const TABS = [
  { key: "samples", label: "Samples" },
  { key: "location", label: "By location" },
  { key: "imports", label: "Imports" },
] as const;

// Quality → Lab Results: samples (filtered by sampled date, region,
// organisation, location, lab and out of spec), one location's results as a
// grid, and the imported files.
export default async function LabResultsPage(props: PageProps<"/admin/quality">) {
  const roles = await requireRole(QUALITY_READERS);
  const params = await props.searchParams;
  const tab = TABS.find((t) => t.key === params.tab)?.key ?? "samples";
  const canEdit = isQualityAdmin(roles);

  const timeZone = await getAppTimeZone();
  const today = todayInZone(timeZone);
  const filter = parseQualityFilter(params, today);
  const importIds = tab === "samples" ? parseImportIds(params) : [];
  const qs = filterParams(filter);

  let content: React.ReactNode;
  if (tab === "imports") {
    content = <ImportsTable imports={await listImports()} canEdit={canEdit} timeZone={timeZone} />;
  } else {
    const options = await listFilterOptions();
    const filters = (
      <QualityFilters
        filter={filter}
        tab={tab}
        today={today}
        regions={options.regions}
        organisations={options.organisations}
        locations={options.locations}
        labs={options.labs}
        requireLocation={tab === "location"}
      />
    );
    if (tab === "samples") {
      const samples = await listSamples(filter, importIds);
      content = (
        <>
          {importIds.length > 0 ? (
            <p className="mb-5 flex flex-wrap items-center gap-2 rounded-card border border-border bg-card px-4 py-3 text-[13px] text-ink">
              Showing the samples of {importIds.length === 1 ? "one import" : `${importIds.length} imports`}, whatever
              their sampled date.
              <Link href="/admin/quality" className="font-semibold text-primary hover:text-primary-hover">
                Show all samples
              </Link>
            </p>
          ) : (
            filters
          )}
          <SamplesTable samples={samples} timeZone={timeZone} />
        </>
      );
    } else {
      const location = options.locations.find((l) => l.id === filter.location);
      const grid = location ? await getLocationGrid(filter) : null;
      content = (
        <>
          {filters}
          {location && grid ? (
            <LocationGrid locationName={location.name} samples={grid.samples} results={grid.results} />
          ) : (
            <p className="rounded-card border border-border bg-card px-4 py-8 text-center text-sm text-muted">
              Pick a location to see its results over time.
            </p>
          )}
        </>
      );
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumb="Quality / Lab Results"
        title="Lab Results"
        actions={
          canEdit && (
            <Link
              href="/admin/quality/import"
              className="flex h-[38px] items-center gap-2 rounded-control bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
            >
              <UploadIcon className="h-4 w-4" />
              Import
            </Link>
          )
        }
      />

      <div className="px-4 pb-10 md:px-8">
        <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TABS.map((t) => {
            const p = new URLSearchParams(t.key === "imports" ? undefined : qs);
            if (t.key !== "samples") p.set("tab", t.key);
            const href = p.toString() ? `/admin/quality?${p}` : "/admin/quality";
            return (
              <Link
                key={t.key}
                href={href}
                className={`border-b-2 px-4 py-2.5 text-sm font-semibold whitespace-nowrap transition-colors ${
                  tab === t.key ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink"
                }`}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>

        {content}
      </div>
    </div>
  );
}
