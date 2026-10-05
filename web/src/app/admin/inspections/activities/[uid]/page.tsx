import Link from "next/link";
import { notFound } from "next/navigation";
import { getCurrentUser, requireRole } from "@/lib/auth";
import { formatDateTime } from "@/lib/incidents/format";
import { todayInZone } from "@/lib/inspections/dates";
import { INSPECTION_READERS, canEditActivity, isInspectionAdmin } from "@/lib/inspections/permissions";
import { ChevronLeftIcon } from "../../../icons";
import { Gallery } from "../../../incidents/photos";
import { PageHeader } from "../../../page-header";
import { sectionHeadingClass, tableHeadCellClass } from "../../../ui";
import { getActivityDetail, getAppTimeZone, getInspectionImageDownloadUrl } from "../../actions";
import { GradingBadge } from "../../badges";
import { DeleteActivityButton } from "./delete-button";

// InspectionActivity_ViewInspectionValue: one activity's values, gradings and
// photos (InspectionValue_ViewImages; admins can download).
export default async function ActivityPage(props: PageProps<"/admin/inspections/activities/[uid]">) {
  const roles = await requireRole(INSPECTION_READERS);
  const { uid } = await props.params;
  const n = Number(uid);
  if (!Number.isInteger(n) || n <= 0) notFound();

  const [activity, timeZone, user] = await Promise.all([getActivityDetail(n), getAppTimeZone(), getCurrentUser()]);
  if (!activity) notFound();

  const isAdmin = isInspectionAdmin(roles);
  const today = todayInZone(timeZone);
  const canEdit = canEditActivity(roles, user?.id ?? null, activity, (iso) => todayInZone(timeZone, new Date(iso)) === today);

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader
        breadcrumb="Asset Management / Inspections"
        title={`Inspection ${activity.legacy_uid}`}
        actions={
          <>
            {canEdit && (
              <Link
                href={`/admin/inspections/activities/${activity.legacy_uid}/edit`}
                className="flex h-[38px] items-center rounded-control bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
              >
                Edit
              </Link>
            )}
            {isAdmin && <DeleteActivityButton id={activity.id} label={`${activity.legacy_uid} of ${activity.asset.name}`} />}
          </>
        }
      />
      <div className="flex flex-col gap-4 px-4 pb-10 md:px-8">
        <Link
          href={isAdmin ? "/admin/inspections?tab=activities" : "/admin/inspections?tab=today"}
          className="inline-flex w-fit items-center gap-1 text-[13px] font-medium text-muted hover:text-ink"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          Inspections
        </Link>

        <section className="max-w-4xl rounded-card border border-border bg-card px-5 py-4">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Detail label="Asset">
              {activity.asset.name} <span className="font-mono text-xs text-muted">{activity.asset.code}</span>
            </Detail>
            <Detail label="Asset type">{activity.asset.asset_type.name}</Detail>
            <Detail label="Location">{activity.asset.location.name}</Detail>
            <Detail label="Inspection date">{formatDateTime(activity.inspection_date, timeZone)}</Detail>
            <Detail label="Inspected by">{activity.inspected_by_name ?? "—"}</Detail>
            <Detail label="Instruction">
              {activity.instruction ? (
                <Link
                  href={`/admin/inspections/instructions/${activity.instruction.legacy_uid}`}
                  className="text-primary hover:text-primary-hover"
                >
                  {activity.instruction.name}
                </Link>
              ) : (
                "Ad hoc"
              )}
            </Detail>
            <Detail label="Grading">
              <GradingBadge grading={activity.grading} />
            </Detail>
          </dl>
        </section>

        <section className="max-w-4xl overflow-hidden rounded-card border border-border bg-card">
          <div className="border-b border-border px-5 py-3">
            <h2 className={sectionHeadingClass}>Values</h2>
          </div>
          {activity.values.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">This inspection has no values.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="hidden sm:table-header-group">
                <tr className="bg-table-head">
                  <th className={`${tableHeadCellClass} !px-5`}>Inspection</th>
                  <th className={tableHeadCellClass}>Value</th>
                  <th className={tableHeadCellClass}>Grading</th>
                  <th className={tableHeadCellClass}>Photos</th>
                </tr>
              </thead>
              <tbody>
                {activity.values.map((v) => (
                  <tr key={v.id} id={v.id} className="flex flex-col gap-1 border-t border-border px-5 py-3 align-top sm:table-row sm:px-0">
                    <td className="font-medium text-ink sm:px-5 sm:py-3">
                      {v.inspection.name}
                      {!v.is_current && (
                        <span className="ml-2 rounded-full bg-black/[.05] px-2 py-0.5 text-[11px] font-medium text-muted">
                          superseded
                        </span>
                      )}
                    </td>
                    <td className="whitespace-pre-line text-ink sm:px-3 sm:py-3">{v.display_value || "—"}</td>
                    <td className="sm:px-3 sm:py-3">
                      {v.grading ? (
                        <GradingBadge grading={v.grading} />
                      ) : (
                        <span className="hidden text-muted sm:inline">—</span>
                      )}
                    </td>
                    <td className="sm:px-3 sm:py-3">
                      {v.images.length > 0 ? (
                        <Gallery
                          images={v.images}
                          canDownload={isAdmin}
                          getDownloadUrl={getInspectionImageDownloadUrl}
                          small
                        />
                      ) : (
                        <span className="hidden text-muted sm:inline">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <dt className="w-28 shrink-0 text-[13px] text-muted">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}
