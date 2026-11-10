import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { parseGridParams } from "@/lib/grid/params";
import { importsGrid, samplesGrid } from "@/lib/grid/specs/quality";
import { todayInZone } from "@/lib/inspections/dates";
import { filterParams, parseQualityFilter } from "@/lib/quality/filter";
import { QUALITY_READERS, isQualityAdmin } from "@/lib/quality/permissions";
import { PageHeader } from "../page-header";
import { UploadIcon } from "../icons";
import { getAppTimeZone } from "../services/actions";
import {
  getLocationGrid,
  listFilterOptions,
  listImportGrid,
  listQualityUserOptions,
  listSampleGrid,
  listSampleGridOptions,
  listStagedImportIds,
} from "./actions";
import { QualityFilters } from "./filters";
import { ImportsGrid } from "./imports-table";
import { LocationGrid } from "./location-grid";
import { SamplesGrid } from "./samples-table";

const TABS = [
  { key: "samples", label: "Samples" },
  { key: "location", label: "By location" },
  { key: "imports", label: "Imports" },
] as const;

// Quality → Lab Results: the samples and the imported files as grids (a
// filter in every column), and one location's results over time (period,
// region, organisation, location, lab and out-of-spec filters).
export default async function LabResultsPage(props: PageProps<"/admin/quality">) {
  const roles = await requireRole(QUALITY_READERS);
  const searchParams = await props.searchParams;
  const tab = TABS.find((t) => t.key === searchParams.tab)?.key ?? "samples";
  const canEdit = isQualityAdmin(roles);

  const timeZone = await getAppTimeZone();
  const today = todayInZone(timeZone);

  let content: React.ReactNode;
  // By location's filters carry over when switching to it from itself only.
  let locationQs = "";
  if (tab === "samples") {
    const params = parseGridParams(searchParams, samplesGrid);
    const [result, options] = await Promise.all([listSampleGrid(params, timeZone), listSampleGridOptions()]);
    content = <SamplesGrid result={result} params={params} options={options} canEdit={canEdit} timeZone={timeZone} />;
  } else if (tab === "imports") {
    const params = parseGridParams(searchParams, importsGrid);
    const [result, userOptions, stagedIds] = await Promise.all([
      listImportGrid(params, timeZone),
      listQualityUserOptions(),
      listStagedImportIds(),
    ]);
    content = (
      <ImportsGrid
        result={result}
        params={params}
        userOptions={userOptions}
        stagedIds={stagedIds}
        canEdit={canEdit}
        timeZone={timeZone}
      />
    );
  } else {
    const filter = parseQualityFilter(searchParams, today);
    locationQs = filterParams(filter).toString();
    const options = await listFilterOptions();
    const location = options.locations.find((l) => l.id === filter.location);
    const grid = location ? await getLocationGrid(filter) : null;
    content = (
      <>
        <QualityFilters
          filter={filter}
          tab={tab}
          today={today}
          regions={options.regions}
          organisations={options.organisations}
          locations={options.locations}
          labs={options.labs}
          requireLocation
        />
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
            const p = new URLSearchParams(t.key === "location" && tab === "location" ? locationQs : undefined);
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
