import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { parseGridParams } from "@/lib/grid/params";
import { activitiesGrid, cumulativeGrid, scheduledGrid, valuesGrid } from "@/lib/grid/specs/inspections";
import { instructionsGrid } from "@/lib/grid/specs/instructions";
import { todayInZone } from "@/lib/inspections/dates";
import {
  INSPECTION_READERS,
  canSeeBackOffice,
  isInspectionAdmin,
  isInspectionWriter,
} from "@/lib/inspections/permissions";
import { PageHeader } from "../page-header";
import { PlusIcon } from "../icons";
import * as actions from "./actions";
import { MyInstructionsView, TodayView } from "./field-views";
import { InstructionsPanel } from "./instructions-panel";
import { ActivitiesPanel, CumulativePanel, ValuesPanel } from "./results-panels";
import { SchedulesPanel } from "./schedules-panel";

const FIELD_TABS = [
  { key: "today", label: "Today" },
  { key: "my-instructions", label: "My instructions" },
] as const;

const BACK_OFFICE_TABS = [
  { key: "instructions", label: "Instructions" },
  { key: "schedules", label: "Scheduled" },
  { key: "activities", label: "Activities" },
  { key: "values", label: "Values" },
  { key: "cumulative", label: "Cumulative values" },
] as const;

type TabKey = (typeof FIELD_TABS)[number]["key"] | (typeof BACK_OFFICE_TABS)[number]["key"];

// Inspection_Overview_PWA + Instruction_Overview (field work, for user /
// admin / system_admin) and Inspection_Overview (the back office, for admins,
// and read-only for viewers) on one page. Each tab loads only its own data.
export default async function InspectionsPage(props: PageProps<"/admin/inspections">) {
  const roles = await requireRole(INSPECTION_READERS);
  const searchParams = await props.searchParams;
  const tabParam = searchParams.tab;

  const isWriter = isInspectionWriter(roles);
  const isAdmin = isInspectionAdmin(roles);
  const backOffice = canSeeBackOffice(roles);
  const tabs = [...(isWriter ? FIELD_TABS : []), ...(backOffice ? BACK_OFFICE_TABS : [])];
  const defaultTab: TabKey = isAdmin || !isWriter ? "instructions" : "today";
  const tab = (tabs.find((t) => t.key === tabParam)?.key ?? defaultTab) as TabKey;

  const timeZone = await actions.getAppTimeZone();
  const today = todayInZone(timeZone);

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumb="Work / Inspections"
        title="Inspections"
        actions={
          isWriter && (
            <Link
              href="/admin/inspections/new"
              className="flex h-[38px] items-center gap-2 rounded-control bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
            >
              <PlusIcon className="h-4 w-4" />
              New inspection
            </Link>
          )
        }
      />

      <div className="px-4 pb-10 md:px-8">
        <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((t, i) => (
            <span key={t.key} className="flex items-center">
              {isWriter && backOffice && i === FIELD_TABS.length && (
                <span className="mx-2 h-5 w-px bg-border" aria-hidden="true" />
              )}
              <Link
                href={`/admin/inspections?tab=${t.key}`}
                className={`border-b-2 px-4 py-2.5 text-sm font-semibold whitespace-nowrap transition-colors ${
                  tab === t.key ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink"
                }`}
              >
                {t.label}
              </Link>
            </span>
          ))}
        </nav>

        <TabContent tab={tab} isAdmin={isAdmin} timeZone={timeZone} today={today} searchParams={searchParams} />
      </div>
    </div>
  );
}

async function TabContent({
  tab,
  isAdmin,
  timeZone,
  today,
  searchParams,
}: {
  tab: TabKey;
  isAdmin: boolean;
  timeZone: string;
  today: string;
  searchParams: Record<string, string | string[] | undefined>;
}) {
  switch (tab) {
    case "today":
      return <TodayView activities={await actions.listMyActivitiesToday()} canDelete={isAdmin} timeZone={timeZone} />;
    case "my-instructions":
      return <MyInstructionsView instructions={await actions.listMyOpenInstructions()} today={today} />;
    case "instructions": {
      const params = parseGridParams(searchParams, instructionsGrid);
      const [result, userOptions] = await Promise.all([
        actions.listInstructionGrid(params, timeZone),
        actions.listUserOptions(),
      ]);
      return (
        <InstructionsPanel
          result={result}
          params={params}
          userOptions={userOptions}
          canEdit={isAdmin}
          today={today}
          timeZone={timeZone}
        />
      );
    }
    case "schedules": {
      const params = parseGridParams(searchParams, scheduledGrid);
      const [result, runs, holidays, userOptions] = await Promise.all([
        actions.listScheduledGrid(params, timeZone),
        isAdmin ? actions.listScheduleRuns() : [],
        actions.listPublicHolidays(),
        actions.listUserOptions(),
      ]);
      return (
        <SchedulesPanel
          result={result}
          params={params}
          userOptions={userOptions}
          runs={runs}
          holidays={holidays}
          canEdit={isAdmin}
          timeZone={timeZone}
        />
      );
    }
    case "activities": {
      const params = parseGridParams(searchParams, activitiesGrid);
      const [result, lookups, userOptions] = await Promise.all([
        actions.listActivityGrid(params, timeZone),
        actions.listInspectionLookups(),
        actions.listUserOptions(),
      ]);
      const props = { result, params, lookups, userOptions, canEdit: isAdmin, timeZone };
      return <ActivitiesPanel {...props} />;
    }
    case "values": {
      const params = parseGridParams(searchParams, valuesGrid);
      const [result, lookups, userOptions] = await Promise.all([
        actions.listValueGrid(params, timeZone),
        actions.listInspectionLookups(),
        actions.listUserOptions(),
      ]);
      const props = { result, params, lookups, userOptions, canEdit: isAdmin, timeZone };
      return <ValuesPanel {...props} />;
    }
    case "cumulative": {
      const params = parseGridParams(searchParams, cumulativeGrid);
      const [result, lookups, userOptions] = await Promise.all([
        actions.listCumulativeGrid(params, timeZone),
        actions.listInspectionLookups(),
        actions.listUserOptions(),
      ]);
      const props = { result, params, lookups, userOptions, canEdit: isAdmin, timeZone };
      return <CumulativePanel {...props} />;
    }
  }
}
