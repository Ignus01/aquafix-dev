import { requireRole } from "@/lib/auth";
import { SERVICE_WRITERS } from "@/lib/services/permissions";
import { PageHeader } from "../../page-header";
import { getAppTimeZone, listServiceFormOptions } from "../actions";
import { ServiceForm } from "../service-form";

// ACT_Service_AddNew → Service_NewEdit.
export default async function NewServicePage() {
  await requireRole(SERVICE_WRITERS);
  const [{ assets, suppliers }, timeZone] = await Promise.all([listServiceFormOptions(), getAppTimeZone()]);

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader breadcrumb="Operations / Services" title="New service" />
      <ServiceForm
        service={null}
        assets={assets}
        suppliers={suppliers}
        timeZone={timeZone}
        canEdit
        canRemoveFiles={false}
        startCompleted={false}
        notice={null}
      />
    </div>
  );
}
