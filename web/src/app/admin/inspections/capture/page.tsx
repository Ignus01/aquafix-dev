import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { INSPECTION_WRITERS } from "@/lib/inspections/permissions";
import { PageHeader } from "../../page-header";
import { getAppTimeZone, getNewCaptureContext } from "../actions";
import { CaptureForm } from "../capture-form";

// ACT_InspectionActivity_New → Inspection_NewEdit, for ?asset=… (ad hoc) or
// ?asset=…&instruction=… (ACT_Instruction_AddNewInspection).
export default async function CapturePage(props: PageProps<"/admin/inspections/capture">) {
  await requireRole(INSPECTION_WRITERS);
  const { asset, instruction } = await props.searchParams;
  const assetId = typeof asset === "string" ? asset : null;
  const instructionId = typeof instruction === "string" ? instruction : null;

  const [context, timeZone] = await Promise.all([
    assetId ? getNewCaptureContext(assetId, instructionId) : Promise.resolve({ error: "Choose an asset first." }),
    getAppTimeZone(),
  ]);

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader breadcrumb="Inspections / New inspection" title="Inspection" />
      {"error" in context ? (
        <div className="px-4 md:px-8">
          <div className="max-w-2xl rounded-card border border-border bg-card px-5 py-8 text-center">
            <p className="text-sm text-ink">{context.error}</p>
            <Link href="/admin/inspections" className="mt-3 inline-block text-sm font-semibold text-primary">
              Back to inspections
            </Link>
          </div>
        </div>
      ) : (
        <CaptureForm context={context} timeZone={timeZone} openedAt={new Date().toISOString()} />
      )}
    </div>
  );
}
