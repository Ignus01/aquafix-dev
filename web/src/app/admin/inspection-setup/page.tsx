import { requireRole } from "@/lib/auth";
import { PageHeader } from "../page-header";
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
export default async function InspectionSetupPage() {
  const roles = await requireRole(["system_admin", "admin", "user", "viewer"]);

  const [inspections, incidentTypes, gradings, assetTypes, accounts, qualityParameters] =
    await Promise.all([
      listInspections(),
      listIncidentTypes(),
      listGradingOptions(),
      listAssetTypeOptions(),
      listAccounts(),
      listQualityParameterOptions(),
    ]);

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader breadcrumb="Master Data / Inspection Setup" title="Inspection Setup" />
      <InspectionSetupTabs
        roles={roles}
        inspections={inspections}
        incidentTypes={incidentTypes}
        gradings={gradings}
        assetTypes={assetTypes}
        accounts={accounts}
        qualityParameters={qualityParameters}
      />
    </div>
  );
}
