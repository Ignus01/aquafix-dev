"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { LocationStatusRow } from "@/lib/incidents/types";
import { SearchBox } from "../components";
import { PinIcon, TagsIcon } from "../icons";

export function LocationStatusList({ locations }: { locations: LocationStatusRow[] }) {
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? locations.filter((l) => l.name.toLowerCase().includes(q)) : locations;
  }, [locations, query]);

  return (
    <div className="flex flex-1 flex-col bg-white">
      <SearchBox value={query} onChange={setQuery} placeholder="Search Location" />
      <ul>
        {rows.map((l) => (
          <li key={l.location_id} className="flex items-center gap-4 border-b border-[#3b4150] px-4 py-4">
            <PinIcon className="h-5 w-5 shrink-0" />
            <span className="flex-1 text-[22px]">{l.name}</span>
            <span
              className={`rounded-[6px] px-3 py-1 text-[20px] font-semibold text-white ${
                l.is_operational ? "bg-[#3bb54a]" : "bg-[#e5384b]"
              }`}
            >
              {l.is_operational ? "On" : "Off"}
            </span>
            <Link href="/m/incidents" aria-label={`Incidents for ${l.name}`}>
              <TagsIcon className="h-6 w-6" />
            </Link>
          </li>
        ))}
        {rows.length === 0 && <li className="px-4 py-6 text-[18px] text-[#5b6480]">No locations found.</li>}
      </ul>
    </div>
  );
}
