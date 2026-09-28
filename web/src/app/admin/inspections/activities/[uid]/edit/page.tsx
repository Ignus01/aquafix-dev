import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { INSPECTION_WRITERS } from "@/lib/inspections/permissions";
import { PageHeader } from "../../../../page-header";
import { getAppTimeZone, getEditCaptureContext } from "../../../actions";
import { CaptureForm } from "../../../capture-form";

// IAC-R06: the PWA "Edit" — reopens Inspection_NewEdit on a saved activity
// (the inspector's own, from today). Saving re-runs the whole algorithm.
export default async function EditActivityPage(props: PageProps<"/admin/inspections/activities/[uid]/edit">) {
  await requireRole(INSPECTION_WRITERS);
  const { uid } = await props.params;
  const n = Number(uid);
  if (!Number.isInteger(n) || n <= 0) notFound();

  const [context, timeZone] = await Promise.all([getEditCaptureContext(n), getAppTimeZone()]);

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader breadcrumb={`Inspections / Inspection ${n}`} title="Edit inspection" />
      {"error" in context ? (
        <div className="px-4 md:px-8">
          <div className="max-w-2xl rounded-card border border-border bg-card px-5 py-8 text-center">
            <p className="text-sm text-ink">{context.error}</p>
            <Link href={`/admin/inspections/activities/${n}`} className="mt-3 inline-block text-sm font-semibold text-primary">
              View the inspection
            </Link>
          </div>
        </div>
      ) : (
        <CaptureForm context={context} timeZone={timeZone} openedAt={context.activity!.inspection_date} />
      )}
    </div>
  );
}
