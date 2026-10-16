"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { formatDateTime } from "@/lib/incidents/format";
import type { LabImportRow, LabImportStatus } from "@/lib/quality/types";
import { Pagination, SearchInput, usePagination } from "../data-grid";
import { dangerLinkButtonClass, linkButtonClass, tableHeadCellClass } from "../ui";
import { cancelImports, deleteImport } from "./actions";
import { ImportFileLink } from "./file-link";

const STATUS_PILL: Record<LabImportStatus, string> = {
  staged: "bg-warning-bg text-warning",
  imported: "bg-success-bg text-success",
  cancelled: "bg-black/[.04] text-muted",
};
const STATUS_TEXT: Record<LabImportStatus, string> = { staged: "Staged", imported: "Imported", cancelled: "Cancelled" };

// One row per uploaded file. Staged imports can be continued or cancelled;
// admins can delete an imported one with its samples.
export function ImportsTable({
  imports,
  canEdit,
  timeZone,
}: {
  imports: LabImportRow[];
  canEdit: boolean;
  timeZone: string;
}) {
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? imports.filter((i) =>
          [i.file_name, i.lab_name, i.batch_no, i.client_name].some((v) => v?.toLowerCase().includes(q)),
        )
      : imports;
  }, [imports, query]);
  const { pageItems, ...paging } = usePagination(rows, query);
  const staged = imports.filter((i) => i.status === "staged");

  function run(action: () => Promise<{ error: string | null }>) {
    setError(null);
    startTransition(async () => {
      const res = await action();
      if (res.error) setError(res.error);
    });
  }

  function remove(i: LabImportRow) {
    const n = i.samples_imported ?? 0;
    if (!confirm(`Delete this import and its ${n} ${n === 1 ? "sample" : "samples"}? This can't be undone.`)) return;
    run(() => deleteImport(i.id));
  }

  return (
    <div data-grid className="flex scroll-mt-4 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <SearchInput value={query} onChange={setQuery} placeholder="Search imports…" />
        <div className="flex-1" />
        {canEdit && staged.length > 1 && (
          <Link
            href={`/admin/quality/import?ids=${staged.map((i) => i.id).join(",")}`}
            className="text-[13px] font-semibold text-primary hover:text-primary-hover"
          >
            Continue all {staged.length} staged
          </Link>
        )}
      </div>
      {error && <p className="border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">{error}</p>}
      <div className="overflow-hidden rounded-card border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-table-head">
                <th className={tableHeadCellClass}>File</th>
                <th className={tableHeadCellClass}>Lab</th>
                <th className={tableHeadCellClass}>Batch</th>
                <th className={tableHeadCellClass}>Client</th>
                <th className={tableHeadCellClass}>Samples</th>
                <th className={tableHeadCellClass}>Status</th>
                <th className={tableHeadCellClass}>Imported</th>
                {canEdit && <th className={tableHeadCellClass}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted">
                    {imports.length === 0 ? "No files have been imported yet." : "No imports match this search."}
                  </td>
                </tr>
              )}
              {pageItems.map((i) => (
                <tr key={i.id} className="border-t border-border align-middle transition-colors hover:bg-row-hover">
                  <td className="max-w-[280px] px-3 py-3">
                    {i.status === "cancelled" ? (
                      <span className="break-all text-muted">{i.file_name}</span>
                    ) : (
                      <ImportFileLink importId={i.id} fileName={i.file_name} />
                    )}
                  </td>
                  <td className="px-3 text-ink">{i.lab_name}</td>
                  <td className="px-3 font-mono text-[13px] text-muted">{i.batch_no ?? "—"}</td>
                  <td className="px-3 text-ink">{i.client_name ?? "—"}</td>
                  <td className="px-3 whitespace-nowrap text-ink tabular-nums">
                    {i.status === "imported" ? (
                      <Link
                        href={`/admin/quality?imports=${i.id}`}
                        className="font-semibold text-primary hover:text-primary-hover"
                      >
                        {i.samples_imported} imported
                      </Link>
                    ) : (
                      "—"
                    )}
                    {i.samples_skipped ? <span className="text-muted"> · {i.samples_skipped} skipped</span> : null}
                  </td>
                  <td className="px-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_PILL[i.status]}`}>
                      {STATUS_TEXT[i.status]}
                    </span>
                  </td>
                  <td className="px-3 whitespace-nowrap text-muted">
                    {i.imported_at
                      ? `${formatDateTime(i.imported_at, timeZone)}${i.imported_by_name ? ` · ${i.imported_by_name}` : ""}`
                      : `Uploaded ${formatDateTime(i.created_at, timeZone)}`}
                  </td>
                  {canEdit && (
                    <td className="px-3 whitespace-nowrap">
                      <div className="flex gap-4">
                        {i.status === "staged" && (
                          <>
                            <Link href={`/admin/quality/import?ids=${i.id}`} className={linkButtonClass}>
                              Continue
                            </Link>
                            <button
                              type="button"
                              disabled={pending}
                              onClick={() => run(() => cancelImports([i.id]))}
                              className={dangerLinkButtonClass}
                            >
                              Cancel
                            </button>
                          </>
                        )}
                        {i.status === "imported" && (
                          <button type="button" disabled={pending} onClick={() => remove(i)} className={dangerLinkButtonClass}>
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  )}
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
