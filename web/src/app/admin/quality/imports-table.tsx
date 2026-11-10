"use client";

import Link from "next/link";
import { useState } from "react";
import { SYSTEM_OPTION } from "@/lib/grid/fields";
import { importsGrid, IMPORT_STATUS_LABELS, type ImportGridRow } from "@/lib/grid/specs/quality";
import type { ChoiceOption, GridParams, GridResult } from "@/lib/grid/types";
import { formatDateTime } from "@/lib/incidents/format";
import type { LabImportStatus } from "@/lib/quality/types";
import { changedColumns, Dash, type GridColumn } from "../grid/columns";
import { Grid } from "../grid/grid";
import type { RowMenuItem } from "../grid/row-menu";
import { cancelImports, deleteImport, getImportFileUrl } from "./actions";

const STATUS_PILL: Record<LabImportStatus, string> = {
  staged: "bg-warning-bg text-warning",
  imported: "bg-success-bg text-success",
  cancelled: "bg-black/[.04] text-muted",
};

// Lab Results → Imports: one row per uploaded file, one page at a time from
// lab_import_grid. A staged file's name continues its import (admins); any
// other opens its samples. Admins can cancel a staged import or delete an
// imported one with its samples.
export function ImportsGrid({
  result,
  params,
  userOptions,
  stagedIds,
  canEdit,
  timeZone,
}: {
  result: GridResult<ImportGridRow>;
  params: GridParams;
  userOptions: ChoiceOption[];
  // Every staged import, for "Continue all".
  stagedIds: string[];
  canEdit: boolean;
  timeZone: string;
}) {
  const [error, setError] = useState<string | null>(null);

  const samplesHref = (i: ImportGridRow) => `/admin/quality?f.file=${i.id}`;
  const continueHref = (ids: string[]) => `/admin/quality/import?ids=${ids.join(",")}`;

  async function run(action: Promise<{ error: string | null; url?: string }>) {
    setError(null);
    const res = await action;
    if (res.error) setError(res.error);
    return res;
  }

  const columns: GridColumn<ImportGridRow>[] = [
    {
      key: "file",
      render: (i) => (
        <span className={`line-clamp-1 max-w-[300px] break-all ${i.status === "cancelled" ? "text-muted" : ""}`} title={i.file_name}>
          {i.file_name}
        </span>
      ),
    },
    { key: "lab", render: (i) => i.lab_name },
    { key: "batch", render: (i) => <span className="font-mono text-[13px] text-muted">{i.batch_no ?? "—"}</span> },
    { key: "client", render: (i) => i.client_name ?? <Dash /> },
    {
      key: "samples",
      render: (i) =>
        i.status === "imported" ? (
          <span className="tabular-nums">
            {i.samples_imported} imported
            {i.samples_skipped ? <span className="text-muted"> · {i.samples_skipped} skipped</span> : null}
          </span>
        ) : (
          <Dash />
        ),
    },
    { key: "skipped", render: (i) => i.samples_skipped ?? <Dash /> },
    {
      key: "status",
      render: (i) => (
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_PILL[i.status]}`}>
          {IMPORT_STATUS_LABELS[i.status]}
        </span>
      ),
    },
    { key: "uploaded", render: (i) => <span className="text-muted tabular-nums">{formatDateTime(i.created_at, timeZone)}</span> },
    ...changedColumns<ImportGridRow>(timeZone),
  ];

  function menu(i: ImportGridRow): RowMenuItem[] {
    const items: RowMenuItem[] = [];
    if (i.status === "imported") items.push({ label: "Show samples", href: samplesHref(i) });
    if (canEdit && i.status === "staged") items.push({ label: "Continue import", href: continueHref([i.id]) });
    if (i.status !== "cancelled") {
      items.push({
        label: "Download file",
        onSelect: async () => {
          const res = await run(getImportFileUrl(i.id));
          if (res.url) window.location.assign(res.url);
        },
      });
    }
    if (canEdit && i.status === "staged") {
      items.push({
        label: "Cancel import",
        danger: true,
        confirm: `${i.file_name} won't be imported, and the uploaded file is removed.`,
        onSelect: () => run(cancelImports([i.id])),
      });
    }
    if (canEdit && i.status === "imported") {
      const n = i.samples_imported ?? 0;
      items.push({
        label: "Delete",
        danger: true,
        confirm: `This import and its ${n} ${n === 1 ? "sample" : "samples"} will be deleted. This can't be undone.`,
        onSelect: () => run(deleteImport(i.id)),
      });
    }
    return items;
  }

  return (
    <>
      {error && <p className="mb-4 border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">{error}</p>}
      <Grid
        mode="server"
        spec={importsGrid}
        result={result}
        params={params}
        columns={columns}
        getKey={(i) => i.id}
        title="Imports"
        timeZone={timeZone}
        rowHref={(i) => (canEdit && i.status === "staged" ? continueHref([i.id]) : samplesHref(i))}
        rowLabel={(i) => `import ${i.file_name}`}
        rowMenu={menu}
        options={{ changed_by: [...userOptions, SYSTEM_OPTION] }}
        emptyLabel="No files have been imported yet."
        primaryAction={
          canEdit &&
          stagedIds.length > 1 && (
            <Link href={continueHref(stagedIds)} className="px-2 text-[13px] font-semibold text-primary hover:text-primary-hover">
              Continue all {stagedIds.length} staged
            </Link>
          )
        }
      />
    </>
  );
}
