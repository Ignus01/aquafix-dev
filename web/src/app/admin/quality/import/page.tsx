import { requireRole } from "@/lib/auth";
import { QUALITY_ADMINS } from "@/lib/quality/permissions";
import { PageHeader } from "../../page-header";
import { getImportContext } from "./actions";
import { ImportWizard } from "./wizard";

const uuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

// Quality → Import (system admins and admins). `?ids=` continues staged
// imports from the Imports tab.
export default async function ImportPage(props: PageProps<"/admin/quality/import">) {
  await requireRole(QUALITY_ADMINS);
  const { ids } = await props.searchParams;
  const importIds = (typeof ids === "string" ? ids.split(",") : []).filter(uuid);
  const context = importIds.length ? await getImportContext(importIds) : null;

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader breadcrumb="Quality / Import" title="Import lab results" />
      <ImportWizard
        // A fresh wizard per set of staged imports.
        key={importIds.join(",")}
        initialContext={context && context.imports.length ? context : null}
        missingStaged={importIds.length > 0 && !context?.imports.length}
      />
    </div>
  );
}
