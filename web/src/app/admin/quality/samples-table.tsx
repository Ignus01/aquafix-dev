"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { formatDay } from "@/lib/dashboard/format";
import { formatDate } from "@/lib/incidents/format";
import type { SampleOverview } from "@/lib/quality/types";
import { Pagination, SearchInput, SortableTh, sortRows, usePagination, useSort, type SortValue } from "../data-grid";
import { OutOfSpec } from "./result-cell";

const th = "px-4 py-2.5 text-left text-[11px] font-semibold text-muted whitespace-nowrap";

const COLUMNS: { key: string; label: string; value: (s: SampleOverview) => SortValue }[] = [
  { key: "sampled_on", label: "Sampled", value: (s) => s.sampled_on },
  { key: "location", label: "Location", value: (s) => s.location_name },
  { key: "lab_no", label: "Lab no", value: (s) => s.lab_no },
  { key: "lab", label: "Lab", value: (s) => s.lab_name },
  { key: "batch", label: "Batch", value: (s) => s.batch_no },
  { key: "sample_type", label: "Sample type", value: (s) => s.sample_type },
  { key: "out_of_spec", label: "Out of spec", value: (s) => s.out_of_spec },
  { key: "imported", label: "Imported", value: (s) => s.imported_at },
];

// Samples, newest first. Clicking a row opens the sample.
export function SamplesTable({ samples, timeZone }: { samples: SampleOverview[]; timeZone: string }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [sort, toggleSort] = useSort();

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? samples.filter((s) =>
          [s.location_name, s.lab_no, s.lab_name, s.batch_no, s.sample_type, s.lab_locality, s.client_name]
            .some((v) => v?.toLowerCase().includes(q)),
        )
      : samples;
    const col = sort && COLUMNS.find((c) => c.key === sort.key);
    return sort && col ? sortRows(list, col.value, sort.desc) : list;
  }, [samples, query, sort]);
  const { pageItems, ...paging } = usePagination(rows, `${query}|${sort?.key}|${sort?.desc}`);

  return (
    <div data-grid className="flex scroll-mt-4 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <SearchInput value={query} onChange={setQuery} placeholder="Search samples…" />
      </div>
      <div className="overflow-hidden rounded-card border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-table-head">
                {COLUMNS.map((c) => (
                  <SortableTh key={c.key} label={c.label} sortKey={c.key} sort={sort} onSort={toggleSort} className={th} />
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-4 py-8 text-center text-muted">
                    {samples.length === 0 ? "No samples match these filters." : "No samples match this search."}
                  </td>
                </tr>
              )}
              {pageItems.map((s) => (
                <tr
                  key={s.id}
                  onClick={() => router.push(`/admin/quality/samples/${s.id}`)}
                  className="h-[50px] cursor-pointer border-t border-border transition-colors hover:bg-row-hover"
                >
                  <td className="px-4 whitespace-nowrap text-ink">
                    <Link
                      href={`/admin/quality/samples/${s.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="font-semibold text-primary hover:text-primary-hover"
                    >
                      {formatDay(s.sampled_on)}
                    </Link>
                  </td>
                  <td className="px-4 text-ink">{s.location_name}</td>
                  <td className="px-4 font-mono text-[13px] text-muted">{s.lab_no}</td>
                  <td className="px-4 text-ink">{s.lab_name}</td>
                  <td className="px-4 font-mono text-[13px] text-muted">{s.batch_no ?? "—"}</td>
                  <td className="px-4 text-ink">{s.sample_type ?? "—"}</td>
                  <td className="px-4">
                    <OutOfSpec count={s.out_of_spec} names={s.out_of_spec_names} inconclusive={s.inconclusive} />
                  </td>
                  <td className="px-4 whitespace-nowrap text-muted">
                    {formatDate(s.imported_at, timeZone)}
                    {s.imported_by_name && ` · ${s.imported_by_name}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pagination {...paging} className="border-t border-border px-4 py-2" />
      </div>
    </div>
  );
}
