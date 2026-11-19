"use client";

import { useState } from "react";
import type { Option } from "@/lib/stock-manager/docs";
import type { OnHand } from "../../../admin/stock-manager/actions";
import { BanIcon } from "../../icons";
import { Empty, mInput, mLabel } from "../../ui";

const plain = (n: number) => Number(n).toLocaleString("en-ZA", { maximumFractionDigits: 3 });
const todayIso = () => new Date().toISOString().slice(0, 10);

export function OnHandList({
  areas,
  items,
  onHand,
  initialArea,
  myKit,
}: {
  areas: Option[];
  items: Option[];
  onHand: OnHand[];
  initialArea: string;
  myKit: string | null;
}) {
  const [area, setArea] = useState(initialArea);
  const itemName = new Map(items.map((o) => [o.value, o.label]));
  const rows = onHand
    .filter((r) => r.storage_area_id === area && r.qty !== 0)
    .sort((a, b) => (itemName.get(a.item_id) ?? "").localeCompare(itemName.get(b.item_id) ?? ""));
  // My kit first, then the rest by name.
  const ordered = [...areas].sort((a, b) => Number(b.value === myKit) - Number(a.value === myKit) || a.label.localeCompare(b.label));

  return (
    <div className="flex-1 bg-white">
      <div className="px-4 pt-3 pb-2">
        <label htmlFor="area" className={mLabel}>
          Storage area
        </label>
        <select id="area" className={mInput} value={area} onChange={(e) => setArea(e.target.value)}>
          <option value="">Select…</option>
          {ordered.map((a) => (
            <option key={a.value} value={a.value}>
              {a.value === myKit ? `My kit — ${a.label}` : a.label}
            </option>
          ))}
        </select>
      </div>
      {!area ? (
        <Empty icon={<BanIcon className="h-6 w-6 shrink-0" />}>Choose a storage area</Empty>
      ) : rows.length === 0 ? (
        <Empty icon={<BanIcon className="h-6 w-6 shrink-0" />}>Nothing in stock here</Empty>
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={r.item_id} className="flex items-baseline justify-between gap-3 border-b border-[#e6e8f0] px-4 py-3.5">
              <span className="min-w-0 flex-1">
                <span className="block text-[19px] font-semibold">{itemName.get(r.item_id) ?? "—"}</span>
                {r.next_expiry && (
                  <span className={`text-[16px] ${r.next_expiry < todayIso() ? "font-semibold text-[#d92d20]" : "text-[#5b6480]"}`}>
                    {r.next_expiry < todayIso() ? "Expired " : "Next expiry "}
                    {r.next_expiry}
                  </span>
                )}
              </span>
              <span className={`shrink-0 text-[21px] font-semibold tabular-nums ${r.qty < 0 ? "text-[#d92d20]" : ""}`}>{plain(r.qty)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
