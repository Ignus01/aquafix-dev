"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { ActivityListRow } from "@/lib/inspections/types";
import { SearchBox } from "../components";
import { shortDateTime } from "../format";
import { BanIcon, PinIcon, PlusIcon } from "../icons";
import { Empty } from "../ui";

export function InspectionOverview({ activities, timeZone }: { activities: ActivityListRow[]; timeZone: string }) {
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return activities;
    return activities.filter((a) =>
      [a.asset.location.name, a.asset.name, a.asset.asset_type.name].some((s) => s.toLowerCase().includes(q)),
    );
  }, [activities, query]);

  return (
    <div className="flex flex-1 flex-col bg-white">
      <SearchBox value={query} onChange={setQuery} placeholder="Search Location, Asset, or Asset Type" />
      {rows.length === 0 ? (
        <Empty icon={<BanIcon className="h-6 w-6 shrink-0" />}>No Inspections Have Been Taken Today</Empty>
      ) : (
        <ul>
          {rows.map((a) => (
            <li key={a.id} className="border-b border-[#3b4150]">
              <Link href={`/m/inspections/capture?activity=${a.legacy_uid}`} className="block px-4 py-3.5 active:bg-black/5">
                <div className="flex items-center gap-2 text-[16px] font-semibold text-[#5b6480] uppercase">
                  <PinIcon className="h-4 w-4 text-[#0b1426]" />
                  {a.asset.location.name}
                </div>
                <div className="mt-1 text-[20px] font-semibold">{a.asset.name}</div>
                <div className="flex items-center justify-between text-[17px] text-[#3b4150]">
                  <span>{a.asset.asset_type.name}</span>
                  <span>{shortDateTime(a.inspection_date, timeZone)}</span>
                </div>
                {a.grading && (
                  <span
                    className="mt-1.5 inline-block rounded-[6px] px-2.5 py-0.5 text-[15px] font-semibold text-white"
                    style={{ background: a.grading.hex_colour ?? "#6b7280" }}
                  >
                    {a.grading.name}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link
        href="/m/inspections/new"
        className="fixed right-[max(1rem,calc(50%-224px))] bottom-[84px] z-20 flex h-[68px] w-[68px] items-center justify-center rounded-full bg-[#3bb54a] text-[19px] font-medium text-white shadow-lg"
      >
        <PlusIcon className="h-5 w-5" />
        New
      </Link>
    </div>
  );
}
