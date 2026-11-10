import { requireRole } from "@/lib/auth";
import { withChanged } from "@/lib/grid/changed";
import { PageHeader } from "../page-header";
import { getAppTimeZone } from "../services/actions";
import {
  listAccounts,
  listAssetTypeOptions,
  listGradingOptions,
  listIncidentTypes,
  listInspections,
  listQualityParameterOptions,
} from "./actions";
import { InspectionSetupTabs } from "./tabs-client";

// InspectionSetup.InspectionSetup_Overview — two tabs, Inspections and
// Incident Types. Allocations are managed from inside an Inspection and from
// the Asset Type drawer under Master Data.
export default async function InspectionSetupPage(props: PageProps<"/admin/inspection-setup">) {
  const roles = await requireRole(["system_admin", "admin", "user", "viewer"]);
  const { tab } = await props.searchParams;

  const [[inspections, incidentTypes], gradings, assetTypes, accounts, qualityParameters, timeZone] =
    await Promise.all([
      Promise.all([listInspections(), listIncidentTypes()]).then((lists) => withChanged(...lists)),
      listGradingOptions(),
      listAssetTypeOptions(),
      listAccounts(),
      listQualityParameterOptions(),
      getAppTimeZone(),
    ]);

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader breadcrumb="Setup / Inspection Setup" title="Inspection Setup" />
      <InspectionSetupTabs
        roles={roles}
        inspections={inspections}
        incidentTypes={incidentTypes}
        gradings={gradings}
        assetTypes={assetTypes}
        accounts={accounts}
        qualityParameters={qualityParameters}
        timeZone={timeZone}
        initialTab={typeof tab === "string" ? tab : undefined}
      />
    </div>
  );
}
