"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { isSameDay } from "@/lib/incidents/format";
import { STATUS_LABELS, type IncidentListRow } from "@/lib/incidents/types";
import { SearchBox } from "../components";
import { shortDateTime } from "../format";
import { BanIcon, ClockIcon, CommentIcon, FileIcon, PlusIcon, UserIcon } from "../icons";
import { Empty, StatusPill } from "../ui";

export function IncidentList({
  incidents,
  timeZone,
  userId,
  canCreate,
  mineByDefault,
}: {
  incidents: IncidentListRow[];
  timeZone: string;
  userId: string | null;
  canCreate: boolean;
  mineByDefault: boolean;
}) {
  const [query, setQuery] = useState("");
  const [mine, setMine] = useState(mineByDefault);
  const [now] = useState(() => new Date());

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return incidents.filter((i) => {
      if (i.status === "completed" && !isSameDay(i.created_at, now, timeZone)) return false;
      if (mine && i.created_by !== userId) return false;
      if (!q) return true;
      return [i.location.name, i.incident_type.name, i.comment].some((s) => s.toLowerCase().includes(q));
    });
  }, [incidents, query, mine, userId, now, timeZone]);

  return (
    <div className="flex flex-1 flex-col">
      <SearchBox value={query} onChange={setQuery} placeholder="Search Location, Incident Type or Comment" />
      <label className="flex items-center gap-3 px-5 py-2 text-[17px]">
        <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="h-5 w-5" />
        Only my incidents
      </label>
      {rows.length === 0 ? (
        <Empty icon={<BanIcon className="h-6 w-6 shrink-0" />}>No incidents</Empty>
      ) : (
        <ul>
          {rows.map((i) => (
            <li key={i.id} className="border-b border-[#3b4150]">
              <Link href={`/m/incidents/${i.reference}`} className="block px-4 py-3 active:bg-black/5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3 text-[21px]">
                      <FileIcon className="h-5 w-5 shrink-0" />
                      <span className="truncate">{i.incident_type.name}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-3 text-[21px]">
                      <UserIcon className="h-5 w-5 shrink-0" />
                      <span className="truncate">{i.created_by_name ?? "—"}</span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="flex items-center justify-end gap-2 text-[19px]">
                      {shortDateTime(i.incident_date, timeZone)}
                      <ClockIcon className="h-5 w-5" />
                    </div>
                    <div className="mt-1">
                      <StatusPill status={i.status} label={STATUS_LABELS[i.status]} />
                    </div>
                  </div>
                </div>
                <div className="mt-1 text-[16px] font-semibold text-[#5b6480] uppercase">{i.location.name}</div>
                <div className="mt-1 flex items-start gap-3 text-[21px] leading-snug">
                  <CommentIcon className="mt-1.5 h-5 w-5 shrink-0" />
                  <span>{i.comment}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {canCreate && (
        <Link
          href="/m/incidents/new"
          className="fixed right-[max(1rem,calc(50%-224px))] bottom-[84px] z-20 flex h-[68px] w-[68px] items-center justify-center rounded-full bg-[#3bb54a] text-[19px] font-medium text-white shadow-lg"
        >
          <PlusIcon className="h-5 w-5" />
          New
        </Link>
      )}
    </div>
  );
}
