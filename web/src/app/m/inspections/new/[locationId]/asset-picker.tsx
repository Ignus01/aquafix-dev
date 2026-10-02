"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { AssetOption } from "@/lib/inspections/types";
import { SearchBox } from "../../../components";
import { shortDateTime } from "../../../format";
import { PinIcon } from "../../../icons";

type Row = AssetOption & { last_inspection_date: string | null };

export function AssetPicker({
  location,
  assets,
  timeZone,
  instruction,
}: {
  location: { id: string; name: string };
  assets: Row[];
  timeZone: string;
  instruction: string | null;
}) {
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? assets.filter((a) => [a.name, a.code, a.asset_type.name].some((s) => s.toLowerCase().includes(q)))
      : assets;
  }, [assets, query]);

  return (
    <div className="flex flex-1 flex-col bg-white">
      <div className="flex items-center gap-3 px-4 pt-3 text-[21px] font-semibold text-[#5b6480] uppercase">
        <PinIcon className="h-5 w-5 text-[#0b1426]" />
        {location.name}
      </div>
      <SearchBox value={query} onChange={setQuery} placeholder="Search Asset or Asset Type" />
      <ul>
        {rows.map((a) => (
          <li key={a.id} className="border-b border-[#e6e8f0]">
            <Link
              href={`/m/inspections/capture?asset=${a.id}${instruction ? `&instruction=${instruction}` : ""}`}
              className="block px-4 py-3 active:bg-[#eef0fb]"
            >
              <dl className="grid grid-cols-[110px_1fr] gap-y-0.5 text-[20px] leading-snug">
                <dt className="font-semibold">Asset Type:</dt>
                <dd>{a.asset_type.name}</dd>
                <dt className="font-semibold">Name:</dt>
                <dd>{a.name}</dd>
                <dt className="font-semibold">Code:</dt>
                <dd>{a.code}</dd>
                <dt className="font-semibold">Prev. Insp.</dt>
                <dd>{shortDateTime(a.last_inspection_date, timeZone)}</dd>
              </dl>
            </Link>
          </li>
        ))}
        {rows.length === 0 && <li className="px-4 py-6 text-[18px] text-[#5b6480]">No assets found.</li>}
      </ul>
    </div>
  );
}
