"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { SearchBox } from "../../components";
import { PinIcon } from "../../icons";

export function LocationPicker({
  locations,
  instruction,
}: {
  locations: { id: string; name: string }[];
  instruction: string | null;
}) {
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? locations.filter((l) => l.name.toLowerCase().includes(q)) : locations;
  }, [locations, query]);

  return (
    <div className="flex flex-1 flex-col bg-white">
      <h2 className="pt-3 text-center text-[22px] font-semibold tracking-wide text-[#5b6480] uppercase">Select Location</h2>
      <SearchBox value={query} onChange={setQuery} placeholder="Search Location" />
      <ul>
        {rows.map((l) => (
          <li key={l.id} className="border-b border-[#e6e8f0]">
            <Link
              href={`/m/inspections/new/${l.id}${instruction ? `?instruction=${instruction}` : ""}`}
              className="flex items-center gap-4 px-4 py-4 text-[21px] active:bg-[#eef0fb]"
            >
              <PinIcon className="h-5 w-5 shrink-0" />
              {l.name}
            </Link>
          </li>
        ))}
        {rows.length === 0 && <li className="px-4 py-6 text-[18px] text-[#5b6480]">No locations found.</li>}
      </ul>
    </div>
  );
}
