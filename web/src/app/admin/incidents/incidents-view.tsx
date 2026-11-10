"use client";

import Link from "next/link";
import { useState } from "react";
import type { MasterdataRole } from "@/lib/auth";
import { SYSTEM_OPTION } from "@/lib/grid/fields";
import { incidentsGrid, type IncidentGridRow } from "@/lib/grid/specs/incidents";
import type { ChoiceOption, GridParams, GridResult } from "@/lib/grid/types";
import { canAdvanceStatus, canEditIncident, isIncidentAdmin } from "@/lib/incidents/permissions";
import { formatDateTime } from "@/lib/incidents/format";
import { INCIDENT_STATUSES, STATUS_LABELS, type IncidentStatus, type LocationStatusRow } from "@/lib/incidents/types";
import { changedColumns, Dash, type GridColumn } from "../grid/columns";
import { Grid } from "../grid/grid";
import type { RowMenuItem } from "../grid/row-menu";
import { ChevronRightIcon } from "../icons";
import { advanceIncidentStatus, deleteIncident, setIncidentStatus } from "./actions";
import { IncidentStatusBadge, StatusControl } from "./status-control";

// ICD-R06's next step, offered in the row menu (was a button in the Status
// column).
const ADVANCE: Partial<Record<IncidentStatus, { label: string; confirm?: string }>> = {
  new: { label: "Start" },
  in_progress: { label: "Complete", confirm: "Only an admin can reopen a completed incident." },
};

// Incident_Overview, one page at a time from incident_grid. "Mine" is
// Incident_Overview_PWA's view (the caller's open incidents and today's).
export function IncidentsGrid({
  result,
  params,
  options,
  roles,
  userId,
  timeZone,
  mine,
}: {
  result: GridResult<IncidentGridRow>;
  params: GridParams;
  options: Record<"type" | "location" | "users", ChoiceOption[]>;
  roles: MasterdataRole[];
  userId: string | null;
  timeZone: string;
  mine: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const isAdmin = isIncidentAdmin(roles);

  const viewHref = (r: IncidentGridRow) => `/admin/incidents/${r.reference}`;
  const canEdit = (r: IncidentGridRow) => canEditIncident(roles, userId, r);

  async function run(action: Promise<{ error: string | null }>) {
    setError(null);
    const res = await action;
    if (res.error) setError(res.error);
  }

  const columns: GridColumn<IncidentGridRow>[] = [
    { key: "ref", render: (r) => <span className="font-mono text-[13px]">{r.reference}</span> },
    { key: "type", render: (r) => r.incident_type_name ?? <Dash /> },
    { key: "location", render: (r) => r.location_name ?? <Dash /> },
    {
      key: "comment",
      render: (r) => (
        <span className="line-clamp-1 max-w-[280px] text-muted" title={r.comment}>
          {r.comment}
        </span>
      ),
    },
    {
      key: "photos",
      render: (r) => (
        <>
          {r.image_count}
          {r.note_count > 0 && (
            <span className="ml-2 text-xs text-muted">
              {r.note_count} note{r.note_count === 1 ? "" : "s"}
            </span>
          )}
        </>
      ),
    },
    { key: "status", render: (r) => <IncidentStatusBadge status={r.status} /> },
    { key: "date", render: (r) => <span className="tabular-nums">{formatDateTime(r.incident_date, timeZone)}</span> },
    {
      key: "completed",
      render: (r) =>
        r.completed_at ? <span className="text-muted tabular-nums">{formatDateTime(r.completed_at, timeZone)}</span> : <Dash />,
    },
    { key: "by", render: (r) => r.created_by_name ?? <Dash /> },
    ...changedColumns<IncidentGridRow>(timeZone),
  ];

  function menu(r: IncidentGridRow): RowMenuItem[] {
    const items: RowMenuItem[] = [{ label: "View", href: viewHref(r) }];
    if (canEdit(r)) items.push({ label: "Edit", href: `${viewHref(r)}/edit` });
    const advance = ADVANCE[r.status];
    if (advance && canAdvanceStatus(roles, r)) {
      items.push({
        label: advance.label,
        confirm: advance.confirm,
        danger: false,
        onSelect: () => run(advanceIncidentStatus(r.id, r.status, r.reference)),
      });
    }
    // ICD-R07: admins can set any status, including reopening.
    if (isAdmin) {
      const next = r.status === "new" ? "in_progress" : r.status === "in_progress" ? "completed" : null;
      for (const s of INCIDENT_STATUSES) {
        if (s === r.status || s === next) continue;
        items.push({
          label: s === "new" ? "Set back to New" : r.status === "completed" ? `Reopen as ${STATUS_LABELS[s]}` : `Set to ${STATUS_LABELS[s]}`,
          ...(s === "completed" ? { confirm: ADVANCE.in_progress!.confirm, danger: false } : {}),
          onSelect: () => run(setIncidentStatus(r.id, s, r.reference)),
        });
      }
    }
    items.push({
      label: "Copy link",
      onSelect: () => navigator.clipboard?.writeText(`${window.location.origin}${viewHref(r)}`),
    });
    if (isAdmin) {
      items.push({
        label: "Delete",
        danger: true,
        confirm: `Incident ${r.reference} and its notes and photos will be deleted. This can't be undone.`,
        onSelect: () => run(deleteIncident(r.id)),
      });
    }
    return items;
  }

  return (
    <>
      {error && <p className="mb-4 border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">{error}</p>}
      <Grid
        mode="server"
        spec={incidentsGrid}
        result={result}
        params={params}
        columns={columns}
        getKey={(r) => r.id}
        title={mine ? "My incidents" : "Incidents"}
        timeZone={timeZone}
        rowHref={(r) => (canEdit(r) ? `${viewHref(r)}/edit` : viewHref(r))}
        rowLabel={(r) => `incident ${r.reference}`}
        rowMenu={menu}
        options={{
          type: options.type,
          location: options.location,
          by: options.users,
          changed_by: [...options.users, SYSTEM_OPTION],
        }}
        emptyLabel={mine ? "No open incidents logged by you, and none logged today." : "No incidents have been logged yet."}
        // Main.ACT_ExportToExcel was an admin action. The export route
        // doesn't know the "mine" scope, so it's offered on All only.
        exportable={isAdmin && !mine}
      />
    </>
  );
}

// LocationStatus_Overview: [Active][IsAssetManager] locations, not
// operational first; each opens to its open, location-disabling incidents
// (Location_IncidentView).
export function LocationStatusList({
  locations,
  incidents,
  roles,
}: {
  locations: LocationStatusRow[];
  incidents: IncidentGridRow[];
  roles: MasterdataRole[];
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const isAdmin = isIncidentAdmin(roles);

  if (locations.length === 0) {
    return (
      <div className="rounded-card border border-border bg-card px-4 py-10 text-center text-sm text-muted">
        No active asset-manager locations.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-card border border-border bg-card">
      {[...locations]
        .sort((a, b) => Number(a.is_operational) - Number(b.is_operational) || a.name.localeCompare(b.name))
        .map((loc) => {
          const open = incidents.filter((i) => i.location_id === loc.location_id);
          const isOpen = expanded === loc.location_id;
          return (
            <div key={loc.location_id} className="border-t border-border first:border-t-0">
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : loc.location_id)}
                aria-expanded={isOpen}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-row-hover"
              >
                <ChevronRightIcon
                  className={`h-4 w-4 shrink-0 text-muted transition-transform ${isOpen ? "rotate-90" : ""}`}
                />
                <span className="flex-1 font-medium text-ink">{loc.name}</span>
                {loc.is_operational ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-success-bg px-2.5 py-0.5 text-xs font-semibold text-success">
                    <span className="h-1.5 w-1.5 rounded-full bg-success" />
                    Operational
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-danger-bg px-2.5 py-0.5 text-xs font-semibold text-danger">
                    <span className="h-1.5 w-1.5 rounded-full bg-danger" />
                    Not operational · {loc.open_disabling_incident_count}
                  </span>
                )}
              </button>
              {isOpen && (
                <div className="bg-table-head px-4 py-3 md:pl-11">
                  {open.length === 0 ? (
                    <p className="text-[13px] text-muted">{loc.name} is Operational.</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {open.map((i) => (
                        <li
                          key={i.id}
                          className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-control border border-border bg-card px-3 py-2.5"
                        >
                          <Link
                            href={`/admin/incidents/${i.reference}`}
                            className="font-mono text-[13px] font-semibold text-primary hover:text-primary-hover"
                          >
                            #{i.reference}
                          </Link>
                          <span className="text-sm font-medium text-ink">{i.incident_type_name}</span>
                          <span className="line-clamp-1 min-w-0 flex-1 text-[13px] text-muted">{i.comment}</span>
                          <StatusControl incident={i} canAdvance={canAdvanceStatus(roles, i)} canSetAny={isAdmin} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}
