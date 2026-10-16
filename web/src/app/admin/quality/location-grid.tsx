"use client";

import Link from "next/link";
import { formatDay } from "@/lib/dashboard/format";
import { formatResult, rangeText } from "@/lib/quality/evaluate";
import type { ResultRow, SampleOverview } from "@/lib/quality/types";
import { DownloadIcon } from "../icons";
import { secondaryButtonClass } from "../ui";
import { ResultValue } from "./result-cell";

function csvCell(value: string | number | null) {
  const s = value === null ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// One location's samples: a row per parameter (in sort order), a column per
// sample, newest on the left, and the acceptable range last.
export function LocationGrid({
  locationName,
  samples,
  results,
}: {
  locationName: string;
  samples: SampleOverview[];
  results: ResultRow[];
}) {
  // Newest first (the server's order), then by lab no for one day.
  const columns = samples;
  const byCell = new Map(results.map((r) => [`${r.parameter_id}:${r.sample_id}`, r]));
  const params = [...new Map(results.map((r) => [r.parameter_id, r])).values()].sort(
    (a, b) => a.sort_order - b.sort_order || a.parameter_name.localeCompare(b.parameter_name),
  );

  function downloadCsv() {
    const lines = [
      ["Parameter", "Unit", ...columns.map((s) => `${s.sampled_on} (${s.lab_no})`), "Acceptable"].map(csvCell).join(","),
      ...params.map((p) =>
        [
          p.parameter_name,
          p.unit,
          ...columns.map((s) => {
            const r = byCell.get(`${p.parameter_id}:${s.id}`);
            return r ? formatResult(r.value, r.below_detection, r.decimals) : "";
          }),
          rangeText(p),
        ]
          .map(csvCell)
          .join(","),
      ),
    ];
    const blob = new Blob([`﻿${lines.join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Lab results - ${locationName.replace(/[\\/:*?"<>|]+/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (columns.length === 0) {
    return (
      <p className="rounded-card border border-border bg-card px-4 py-8 text-center text-sm text-muted">
        {locationName} has no samples matching these filters.
      </p>
    );
  }

  const stickyCell = "sticky left-0 z-10 bg-card";
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted">
          {columns.length} {columns.length === 1 ? "sample" : "samples"} at{" "}
          <span className="font-semibold text-ink">{locationName}</span>. Hover a value for its limit.
        </p>
        <button type="button" onClick={downloadCsv} className={`${secondaryButtonClass} flex items-center gap-2`}>
          <DownloadIcon className="h-4 w-4" />
          Download CSV
        </button>
      </div>
      <div className="overflow-hidden rounded-card border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="text-sm">
            <thead>
              <tr className="bg-table-head">
                <th className={`${stickyCell} !bg-table-head px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider text-muted uppercase`}>
                  Parameter
                </th>
                {columns.map((s) => (
                  <th key={s.id} className="px-3 py-2 text-right text-[11px] font-semibold whitespace-nowrap text-muted">
                    <Link href={`/admin/quality/samples/${s.id}`} className="text-primary hover:text-primary-hover">
                      {formatDay(s.sampled_on)}
                    </Link>
                    <div className="font-mono font-normal">{s.lab_no}</div>
                  </th>
                ))}
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider whitespace-nowrap text-muted uppercase">
                  Acceptable
                </th>
              </tr>
            </thead>
            <tbody>
              {params.map((p) => (
                <tr key={p.parameter_id} className="border-t border-border">
                  <td className={`${stickyCell} px-4 py-2 whitespace-nowrap text-ink`}>
                    {p.parameter_name} <span className="text-xs text-muted">{p.unit}</span>
                  </td>
                  {columns.map((s) => {
                    const r = byCell.get(`${p.parameter_id}:${s.id}`);
                    return (
                      <td key={s.id} className="px-3 py-1.5 text-right">
                        {r ? <ResultValue r={{ ...r, name: r.parameter_name }} /> : <span className="text-muted">—</span>}
                      </td>
                    );
                  })}
                  <td className="px-4 py-2 font-mono text-[13px] whitespace-nowrap text-muted">{rangeText(p)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
