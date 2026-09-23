"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import type { MasterdataRole } from "@/lib/auth";
import {
  canAdvanceStatus,
  isIncidentAdmin,
  isIncidentWriter,
} from "@/lib/incidents/permissions";
import { formatDate, formatDateTime, isSameDay } from "@/lib/incidents/format";
import {
  INCIDENT_STATUSES,
  STATUS_LABELS,
  type IncidentListRow,
  type IncidentStatus,
  type LocationStatusRow,
} from "@/lib/incidents/types";
import { ChevronRightIcon, DownloadIcon, SearchIcon } from "../icons";
import { inputClass, tableHeadCellClass } from "../ui";
import { deleteIncident } from "./actions";
import { StatusControl } from "./status-control";

type Tab = "incidents" | "locations";
type Scope = "open_today" | "all";

const chipClass = (on: boolean) =>
  `flex h-[38px] items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors ${
    on
      ? "border-primary bg-primary/10 text-primary-hover"
      : "border-border bg-white text-ink hover:bg-black/[.02]"
  }`;

function csvCell(value: string | number | null) {
  const s = value === null ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function IncidentsView({
  roles,
  userId,
  incidents,
  locations,
  timeZone,
}: {
  roles: MasterdataRole[];
  userId: string | null;
  incidents: IncidentListRow[];
  locations: LocationStatusRow[];
  timeZone: string;
}) {
  const isAdmin = isIncidentAdmin(roles);
  const isWriter = isIncidentWriter(roles);

  const [tab, setTab] = useState<Tab>("incidents");
  const [query, setQuery] = useState("");
  // Field users start on Incident_Overview_PWA's view: their own incidents
  // that are still open, plus anything they logged today. Admins start on
  // everything (Incident_Overview).
  const [scope, setScope] = useState<Scope>(isAdmin ? "all" : "open_today");
  const [mineOnly, setMineOnly] = useState(!isAdmin && isWriter);
  const [status, setStatus] = useState<IncidentStatus | "">("");
  const [typeId, setTypeId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tableError, setTableError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [now] = useState(() => new Date());

  const typeOptions = useMemo(() => {
    const map = new Map(incidents.map((i) => [i.incident_type.id, i.incident_type.name]));
    return [...map].sort((a, b) => a[1].localeCompare(b[1]));
  }, [incidents]);
  const locationOptions = useMemo(() => {
    const map = new Map(incidents.map((i) => [i.location.id, i.location.name]));
    return [...map].sort((a, b) => a[1].localeCompare(b[1]));
  }, [incidents]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return incidents.filter((i) => {
      if (scope === "open_today" && i.status === "completed" && !isSameDay(i.created_at, now, timeZone)) {
        return false;
      }
      if (mineOnly && i.created_by !== userId) return false;
      if (status && i.status !== status) return false;
      if (typeId && i.incident_type.id !== typeId) return false;
      if (locationId && i.location.id !== locationId) return false;
      if (!q) return true;
      return [
        String(i.reference),
        i.comment,
        i.location.name,
        i.incident_type.name,
        i.created_by_name ?? "",
      ].some((v) => v.toLowerCase().includes(q));
    });
  }, [incidents, query, scope, mineOnly, status, typeId, locationId, userId, now, timeZone]);

  const notOperational = locations.filter((l) => !l.is_operational).length;

  function handleDelete(row: IncidentListRow) {
    if (!confirm(`Delete incident ${row.reference}? Its notes and photos are deleted too. This cannot be undone.`)) {
      return;
    }
    setTableError(null);
    startTransition(async () => {
      const res = await deleteIncident(row.id);
      if (res.error) setTableError(res.error);
    });
  }

  // Main.ACT_ExportToExcel ("Incidents" sheet) — as CSV of the filtered rows.
  function exportCsv() {
    const header = [
      "Reference", "Incident Type", "Location", "Comment", "Images", "Notes",
      "Status", "Incident Date", "Completed Date", "Created By",
    ];
    const lines = filtered.map((i) =>
      [
        i.reference,
        i.incident_type.name,
        i.location.name,
        i.comment,
        i.image_count,
        i.note_count,
        STATUS_LABELS[i.status],
        formatDateTime(i.incident_date, timeZone),
        i.completed_at ? formatDateTime(i.completed_at, timeZone) : "",
        i.created_by_name ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
    const blob = new Blob(["﻿" + [header.join(","), ...lines].join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `incidents-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const tabs: { key: Tab; label: string; count: number; alert?: boolean }[] = [
    { key: "incidents", label: "Incidents", count: incidents.length },
    { key: "locations", label: "Location status", count: notOperational, alert: notOperational > 0 },
  ];

  return (
    <div className="px-4 pb-10 md:px-8">
      <div className="mb-6 flex flex-wrap gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
              tab === t.key ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {t.label}
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${
                t.alert
                  ? "bg-danger-bg text-danger"
                  : tab === t.key
                    ? "bg-primary/10 text-primary"
                    : "bg-black/[.04] text-muted"
              }`}
              title={t.key === "locations" ? "Locations not operational" : undefined}
            >
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {tab === "incidents" && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <label className="flex h-[38px] w-full items-center gap-2 rounded-full border border-border bg-white px-3 text-muted sm:w-72">
              <SearchIcon className="h-4 w-4 shrink-0" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search incidents…"
                className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted"
              />
            </label>

            <div className="flex rounded-full border border-border bg-white p-0.5">
              {(
                [
                  ["open_today", "Open & today"],
                  ["all", "All"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setScope(key)}
                  className={`h-[32px] rounded-full px-3.5 text-[13px] font-medium transition-colors ${
                    scope === key ? "bg-primary text-white" : "text-ink hover:bg-black/[.03]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {userId && (
              <button type="button" onClick={() => setMineOnly((v) => !v)} className={chipClass(mineOnly)}>
                Logged by me
              </button>
            )}

            <select
              aria-label="Status"
              value={status}
              onChange={(e) => setStatus(e.target.value as IncidentStatus | "")}
              className={`${inputClass} !h-[38px] !w-auto !rounded-full`}
            >
              <option value="">Any status</option>
              {INCIDENT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <select
              aria-label="Incident type"
              value={typeId}
              onChange={(e) => setTypeId(e.target.value)}
              className={`${inputClass} !h-[38px] !w-auto !rounded-full`}
            >
              <option value="">Any type</option>
              {typeOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
            <select
              aria-label="Location"
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className={`${inputClass} !h-[38px] !w-auto !rounded-full`}
            >
              <option value="">Any location</option>
              {locationOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>

            <div className="flex-1" />

            {isAdmin && (
              <button
                type="button"
                onClick={exportCsv}
                disabled={filtered.length === 0}
                className="flex h-[38px] items-center gap-2 rounded-control border border-border bg-white px-3.5 text-sm font-medium text-ink transition-colors hover:bg-black/[.02] disabled:opacity-60"
              >
                <DownloadIcon className="h-4 w-4" />
                Export
              </button>
            )}
          </div>

          {tableError && (
            <p className="border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">{tableError}</p>
          )}

          {filtered.length === 0 ? (
            <div className="rounded-card border border-border bg-card px-4 py-10 text-center text-sm text-muted">
              {incidents.length === 0
                ? "No incidents have been logged yet."
                : scope === "open_today" && !query && !status && !typeId && !locationId
                  ? "No open incidents, and none logged today."
                  : "No incidents match these filters."}
            </div>
          ) : (
            <>
              {/* Phone: cards (Incident_Overview_PWA's gallery). */}
              <div className="flex flex-col gap-2.5 md:hidden">
                {filtered.map((i) => (
                  <div key={i.id} className="rounded-card border border-border bg-card p-4">
                    <Link href={`/admin/incidents/${i.reference}`} className="block">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-semibold text-ink">{i.incident_type.name}</div>
                          <div className="text-[13px] text-muted">{i.location.name}</div>
                        </div>
                        <span className="font-mono text-[13px] text-muted">#{i.reference}</span>
                      </div>
                      <p className="mt-2 line-clamp-2 text-[13px] text-ink">{i.comment}</p>
                      <div className="mt-2 text-xs text-muted">
                        {formatDateTime(i.incident_date, timeZone)}
                        {i.image_count > 0 && ` · ${i.image_count} photo${i.image_count === 1 ? "" : "s"}`}
                        {i.note_count > 0 && ` · ${i.note_count} note${i.note_count === 1 ? "" : "s"}`}
                      </div>
                    </Link>
                    <div className="mt-3">
                      <StatusControl
                        incident={i}
                        canAdvance={canAdvanceStatus(roles, i)}
                        canSetAny={isAdmin}
                        size="md"
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop: the Incident_Overview grid. */}
              <div className="hidden overflow-x-auto rounded-card border border-border bg-card md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-table-head">
                      <th className={`${tableHeadCellClass} !px-4`}>Ref</th>
                      <th className={tableHeadCellClass}>Incident type</th>
                      <th className={tableHeadCellClass}>Location</th>
                      <th className={tableHeadCellClass}>Comment</th>
                      <th className={tableHeadCellClass}>Photos</th>
                      <th className={tableHeadCellClass}>Status</th>
                      <th className={tableHeadCellClass}>Incident date</th>
                      <th className={tableHeadCellClass}>Completed</th>
                      <th className={tableHeadCellClass}>Logged by</th>
                      {isAdmin && <th className={tableHeadCellClass} />}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((i) => (
                      <tr key={i.id} className="border-t border-border align-middle transition-colors hover:bg-row-hover">
                        <td className="px-4 py-2.5">
                          <Link
                            href={`/admin/incidents/${i.reference}`}
                            className="font-mono text-[13px] font-semibold text-primary hover:text-primary-hover"
                          >
                            {i.reference}
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-ink">{i.incident_type.name}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-ink">{i.location.name}</td>
                        <td className="px-3 py-2.5">
                          <span className="line-clamp-1 max-w-[280px] text-muted" title={i.comment}>
                            {i.comment}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-ink">
                          {i.image_count}
                          {i.note_count > 0 && (
                            <span className="ml-2 text-xs text-muted">
                              {i.note_count} note{i.note_count === 1 ? "" : "s"}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <StatusControl
                            incident={i}
                            canAdvance={canAdvanceStatus(roles, i)}
                            canSetAny={isAdmin}
                          />
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-ink">
                          {formatDateTime(i.incident_date, timeZone)}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-muted">
                          {i.completed_at ? formatDate(i.completed_at, timeZone) : "—"}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap text-ink">{i.created_by_name ?? "—"}</td>
                        {isAdmin && (
                          <td className="px-3 py-2.5 text-right">
                            <button
                              disabled={isPending}
                              onClick={() => handleDelete(i)}
                              className="text-xs font-semibold text-danger hover:opacity-80 disabled:opacity-60"
                            >
                              Delete
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {incidents.length >= 1000 && (
            <p className="text-xs text-muted">Showing the 1,000 most recent incidents.</p>
          )}
        </div>
      )}

      {tab === "locations" && (
        <div className="overflow-hidden rounded-card border border-border bg-card">
          {locations.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-muted">
              No active asset-manager locations.
            </p>
          ) : (
            [...locations]
              .sort((a, b) => Number(a.is_operational) - Number(b.is_operational) || a.name.localeCompare(b.name))
              .map((loc) => {
                // Location_IncidentView: this location's open, location-disabling incidents.
                const open = incidents.filter(
                  (i) =>
                    i.location.id === loc.location_id &&
                    i.incident_type.disables_location &&
                    i.status !== "completed",
                );
                const isOpen = expanded === loc.location_id;
                return (
                  <div key={loc.location_id} className="border-t border-border first:border-t-0">
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : loc.location_id)}
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
                                <span className="text-sm font-medium text-ink">{i.incident_type.name}</span>
                                <span className="line-clamp-1 min-w-0 flex-1 text-[13px] text-muted">
                                  {i.comment}
                                </span>
                                <StatusControl
                                  incident={i}
                                  canAdvance={canAdvanceStatus(roles, i)}
                                  canSetAny={isAdmin}
                                />
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
          )}
        </div>
      )}
    </div>
  );
}
