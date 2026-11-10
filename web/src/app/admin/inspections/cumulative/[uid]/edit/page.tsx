import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { INSPECTION_ADMINS } from "@/lib/inspections/permissions";
import { PageHeader } from "../../../../page-header";
import { getCumulativeValue } from "../../../actions";
import { BackLink } from "../../../back-link";
import { CumulativeForm } from "../../../value-forms";

// InspectionCumulativeValue_Edit (admins): where the Cumulative grid's ID
// link goes.
export default async function EditCumulativePage(props: PageProps<"/admin/inspections/cumulative/[uid]/edit">) {
  await requireRole(INSPECTION_ADMINS);
  const { uid } = await props.params;
  const n = Number(uid);
  if (!Number.isInteger(n) || n <= 0) notFound();

  const row = await getCumulativeValue(n);
  if (!row) notFound();

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader breadcrumb="Work / Inspections / Cumulative values" title={`Edit cumulative value ${n}`} />
      <div className="flex flex-col gap-4 px-4 pb-10 md:px-8">
        <BackLink href="/admin/inspections?tab=cumulative" label="Cumulative values" />
        <div className="max-w-2xl rounded-card border border-border bg-card p-5 md:p-6">
          <CumulativeForm row={row} />
        </div>
      </div>
    </div>
  );
}
