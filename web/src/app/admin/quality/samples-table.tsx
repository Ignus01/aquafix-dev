"use client";

import { useState } from "react";
import { formatDay } from "@/lib/dashboard/format";
import { SYSTEM_OPTION } from "@/lib/grid/fields";
import { samplesGrid, type SampleGridRow } from "@/lib/grid/specs/quality";
import type { ChoiceOption, GridParams, GridResult } from "@/lib/grid/types";
import { changedColumns, Dash, type GridColumn } from "../grid/columns";
import { Grid } from "../grid/grid";
import type { RowMenuItem } from "../grid/row-menu";
import { deleteSample } from "./actions";
import { OutOfSpec } from "./result-cell";

// Lab Results → Samples, one page at a time from lab_sample_grid. The lab
// no opens the sample.
export function SamplesGrid({
  result,
  params,
  options,
  canEdit,
  timeZone,
}: {
  result: GridResult<SampleGridRow>;
  params: GridParams;
  options: Record<"location" | "region" | "organisation" | "lab" | "file" | "users", ChoiceOption[]>;
  canEdit: boolean;
  timeZone: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const href = (s: SampleGridRow) => `/admin/quality/samples/${s.id}`;

  const columns: GridColumn<SampleGridRow>[] = [
    { key: "lab_no", render: (s) => <span className="font-mono text-[13px]">{s.lab_no}</span> },
    { key: "sampled", render: (s) => <span className="whitespace-nowrap">{formatDay(s.sampled_on)}</span> },
    { key: "location", render: (s) => s.location_name },
    { key: "region", render: (s) => s.region_name ?? <Dash /> },
    { key: "organisation", render: (s) => s.organisation_name ?? <Dash /> },
    { key: "lab", render: (s) => s.lab_name },
    { key: "locality", render: (s) => s.lab_locality ?? <Dash /> },
    { key: "batch", render: (s) => <span className="font-mono text-[13px] text-muted">{s.batch_no ?? "—"}</span> },
    { key: "sample_type", render: (s) => s.sample_type ?? <Dash /> },
    {
      key: "out_of_spec",
      render: (s) => <OutOfSpec count={s.out_of_spec} names={s.out_of_spec_names} inconclusive={s.inconclusive} />,
    },
    {
      key: "file",
      render: (s) => (
        <span className="line-clamp-1 max-w-[240px] text-muted" title={s.file_name}>
          {s.file_name}
        </span>
      ),
    },
    ...changedColumns<SampleGridRow>(timeZone),
  ];

  function menu(s: SampleGridRow): RowMenuItem[] {
    const items: RowMenuItem[] = [
      { label: "View", href: href(s) },
      { label: "Samples from this file", href: `/admin/quality?f.file=${s.import_id}` },
      { label: "Copy link", onSelect: () => navigator.clipboard?.writeText(`${window.location.origin}${href(s)}`) },
    ];
    if (canEdit) {
      items.push({
        label: "Delete",
        danger: true,
        confirm: `Sample ${s.lab_no} and its results will be deleted. This can't be undone.`,
        onSelect: async () => {
          setError(null);
          const res = await deleteSample(s.id);
          if (res.error) setError(res.error);
        },
      });
    }
    return items;
  }

  return (
    <>
      {error && <p className="mb-4 border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">{error}</p>}
      <Grid
        mode="server"
        spec={samplesGrid}
        result={result}
        params={params}
        columns={columns}
        getKey={(s) => s.id}
        title="Samples"
        timeZone={timeZone}
        rowHref={href}
        rowLabel={(s) => `sample ${s.lab_no}`}
        rowMenu={menu}
        options={{
          location: options.location,
          region: options.region,
          organisation: options.organisation,
          lab: options.lab,
          file: options.file,
          changed_by: [...options.users, SYSTEM_OPTION],
        }}
        emptyLabel="No lab results have been imported yet."
      />
    </>
  );
}
