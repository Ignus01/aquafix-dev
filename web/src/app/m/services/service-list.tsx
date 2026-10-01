"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { SERVICE_TYPE_LABELS, type ServiceListRow } from "@/lib/services/types";
import { SearchBox } from "../components";
import { shortDate } from "../format";
import { BanIcon, ChevronRightIcon } from "../icons";
import { Empty } from "../ui";

export function ServiceList({ services, timeZone }: { services: ServiceListRow[]; timeZone: string }) {
  const [query, setQuery] = useState("");
  const [now] = useState(() => Date.now());
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? services.filter((s) =>
          [s.asset.name, s.asset.code, SERVICE_TYPE_LABELS[s.service_type], s.supplier?.name ?? ""].some((v) =>
            v.toLowerCase().includes(q),
          ),
        )
      : services;
  }, [services, query]);

  return (
    <div className="flex flex-1 flex-col bg-white">
      <SearchBox value={query} onChange={setQuery} placeholder="Search Asset, Type or Supplier" />
      {rows.length === 0 ? (
        <Empty icon={<BanIcon className="h-6 w-6 shrink-0" />}>No open services</Empty>
      ) : (
        <ul>
          {rows.map((s) => {
            const overdue = new Date(s.due_date).getTime() < now;
            return (
              <li key={s.id} className="border-b border-[#e6e8f0]">
                <Link href={`/m/services/${s.reference}`} className="flex items-center gap-3 px-4 py-3.5 active:bg-[#eef0fb]">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[21px] font-semibold">{s.asset.name}</div>
                    <div className="text-[17px] text-[#5b6480]">
                      {SERVICE_TYPE_LABELS[s.service_type]}
                      {s.supplier ? ` · ${s.supplier.name}` : ""}
                    </div>
                    <div className={`mt-0.5 text-[17px] ${overdue ? "font-semibold text-[#d92d20]" : ""}`}>
                      Due {shortDate(s.due_date, timeZone)}
                    </div>
                  </div>
                  <ChevronRightIcon className="h-5 w-5 shrink-0" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
