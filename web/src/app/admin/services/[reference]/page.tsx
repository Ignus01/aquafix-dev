import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { SERVICE_READERS, isServiceAdmin, isServiceWriter } from "@/lib/services/permissions";
import { PageHeader } from "../../page-header";
import { getAppTimeZone, getServiceDetail, listServiceFormOptions } from "../actions";
import { ServiceForm } from "../service-form";

// Service_NewEdit for an existing service (writers), read-only for viewers.
//   ?complete=1  Service_Edit ("Complete Service"): ACT_Service_Complete's
//                starting point, with Completed ticked and the date set to now.
//   ?next=1      arrived here after completing a scheduled maintenance: this
//                is the new service to confirm.
export default async function ServicePage(props: PageProps<"/admin/services/[reference]">) {
  const roles = await requireRole(SERVICE_READERS);
  const { reference } = await props.params;
  const { complete, next } = await props.searchParams;
  const ref = Number(reference);
  if (!Number.isInteger(ref) || ref <= 0) notFound();

  const [service, { assets, suppliers }, timeZone] = await Promise.all([
    getServiceDetail(ref),
    listServiceFormOptions(),
    getAppTimeZone(),
  ]);
  if (!service) notFound();

  const canEdit = isServiceWriter(roles);
  const completing = canEdit && complete === "1" && !service.is_completed;

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumb="Asset Management / Services"
        title={completing ? `Complete service ${service.reference}` : `Service ${service.reference}`}
      />
      <ServiceForm
        // A fresh form state per service and mode.
        key={`${service.id}-${completing}`}
        service={service}
        assets={assets}
        suppliers={suppliers}
        timeZone={timeZone}
        canEdit={canEdit}
        canRemoveFiles={isServiceAdmin(roles)}
        startCompleted={completing}
        notice={
          next === "1" && canEdit && !service.is_completed
            ? `Please schedule your next service for ${service.asset.code}.`
            : null
        }
      />
    </div>
  );
}
