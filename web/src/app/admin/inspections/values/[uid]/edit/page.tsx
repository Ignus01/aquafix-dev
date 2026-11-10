import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { INSPECTION_ADMINS } from "@/lib/inspections/permissions";
import { PageHeader } from "../../../../page-header";
import { getAppTimeZone, getValueForEdit, getValueIdByUid } from "../../../actions";
import { BackLink } from "../../../back-link";
import { ValueForm } from "../../../value-forms";

// Inspection Values → Edit (admins): where the Values grid's ID link goes.
export default async function EditValuePage(props: PageProps<"/admin/inspections/values/[uid]/edit">) {
  await requireRole(INSPECTION_ADMINS);
  const { uid } = await props.params;
  const n = Number(uid);
  if (!Number.isInteger(n) || n <= 0) notFound();

  const id = await getValueIdByUid(n);
  const [value, timeZone] = await Promise.all([id ? getValueForEdit(id) : null, getAppTimeZone()]);
  if (!value) notFound();

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader breadcrumb="Work / Inspections / Values" title={`Edit inspection value ${n}`} />
      <div className="flex flex-col gap-4 px-4 pb-10 md:px-8">
        <BackLink href="/admin/inspections?tab=values" label="Inspection values" />
        <div className="max-w-2xl rounded-card border border-border bg-card p-5 md:p-6">
          <ValueForm value={value} timeZone={timeZone} />
        </div>
      </div>
    </div>
  );
}
