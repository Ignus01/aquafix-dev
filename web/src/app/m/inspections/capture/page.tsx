import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { INSPECTION_WRITERS } from "@/lib/inspections/permissions";
import { getAppTimeZone, getEditCaptureContext, getNewCaptureContext } from "../../../admin/inspections/actions";
import { Header } from "../../ui";
import { CaptureForm } from "./capture-form";

export const metadata = { title: "Inspection · AquaFix" };

// Inspection_NewEdit: ?asset=… (ad hoc), ?asset=…&instruction=… (from an
// instruction) or ?activity=<uid> (re-open one of my own from today).
export default async function CapturePage(props: PageProps<"/m/inspections/capture">) {
  await requireRole(INSPECTION_WRITERS);
  const { asset, instruction, activity } = await props.searchParams;
  const activityUid = typeof activity === "string" ? Number(activity) : NaN;
  const assetId = typeof asset === "string" ? asset : null;
  const instructionId = typeof instruction === "string" ? instruction : null;

  const [context, timeZone] = await Promise.all([
    Number.isInteger(activityUid)
      ? getEditCaptureContext(activityUid)
      : assetId
        ? getNewCaptureContext(assetId, instructionId)
        : Promise.resolve({ error: "Choose an asset first." }),
    getAppTimeZone(),
  ]);

  return (
    <>
      <Header title={Number.isInteger(activityUid) ? "Edit Inspection" : "New Inspection"} />
      {"error" in context ? (
        <div className="px-4 py-8 text-center">
          <p className="text-[19px]">{context.error}</p>
          <Link href="/m/inspections" className="mt-4 inline-block text-[18px] font-semibold text-[#3a3cd6]">
            Back to inspections
          </Link>
        </div>
      ) : (
        <CaptureForm context={context} timeZone={timeZone} openedAt={new Date().toISOString()} />
      )}
    </>
  );
}
