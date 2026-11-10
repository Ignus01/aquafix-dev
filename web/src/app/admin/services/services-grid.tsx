"use client";

import { useState } from "react";
import { formatDate, formatDateTime } from "@/lib/incidents/format";
import { SYSTEM_OPTION } from "@/lib/grid/fields";
import { openServicesGrid, servicesGrid, type ServiceGridRow } from "@/lib/grid/specs/services";
import type { ChoiceOption, GridParams, GridResult } from "@/lib/grid/types";
import { changedColumns, Dash, type GridColumn } from "../grid/columns";
import { Grid } from "../grid/grid";
import type { RowMenuItem } from "../grid/row-menu";
import { ServiceStatusBadge, ServiceTypeBadge } from "./badges";
import { deleteService } from "./actions";
import { formatMoney } from "./format";

// Service_Overview, one page at a time from service_grid. The Open tab is
// the same grid with the open-only preset (Service_Overview_PWA): there a
// writer's ID link opens "Complete Service" (ACT_Service_Complete).
export function ServicesGrid({
  open,
  result,
  params,
  options,
  canEdit,
  timeZone,
  now,
}: {
  open: boolean;
  result: GridResult<ServiceGridRow>;
  params: GridParams;
  options: Record<"supplier" | "users", ChoiceOption[]>;
  canEdit: boolean;
  timeZone: string;
  // Server render time, so "overdue" agrees between server and browser.
  now: string;
}) {
  const [error, setError] = useState<string | null>(null);

  const viewHref = (s: ServiceGridRow) => `/admin/services/${s.reference}`;
  const completeHref = (s: ServiceGridRow) => `${viewHref(s)}?complete=1`;
  const money = (v: number, s: ServiceGridRow) => (s.is_completed ? formatMoney(v) : <Dash />);

  const columns: GridColumn<ServiceGridRow>[] = [
    { key: "uid", render: (s) => s.reference },
    { key: "asset", render: (s) => <span className="font-mono text-[13px]">{s.asset_code ?? "—"}</span> },
    { key: "asset_name", render: (s) => s.asset_name ?? <Dash /> },
    { key: "due", render: (s) => <span className="tabular-nums">{formatDate(s.due_date, timeZone)}</span> },
    { key: "type", render: (s) => <ServiceTypeBadge type={s.service_type} /> },
    {
      key: "completed",
      render: (s) => <ServiceStatusBadge completed={s.is_completed} overdue={!s.is_completed && s.due_date < now} />,
    },
    {
      key: "completed_date",
      render: (s) =>
        s.completed_date ? <span className="tabular-nums">{formatDateTime(s.completed_date, timeZone)}</span> : <Dash />,
    },
    { key: "supplier", render: (s) => s.supplier_name ?? <Dash /> },
    { key: "performed_by", render: (s) => s.performed_by ?? <Dash /> },
    { key: "invoice", render: (s) => s.invoice_nr ?? <Dash /> },
    { key: "part", align: "right", render: (s) => money(s.total_part_cost, s) },
    { key: "labour", align: "right", render: (s) => money(s.total_labour_cost, s) },
    { key: "total", align: "right", className: "font-semibold", render: (s) => money(s.total_cost, s) },
    {
      key: "comment",
      render: (s) =>
        s.comment ? (
          <span className="line-clamp-1 max-w-[260px] text-muted" title={s.comment}>
            {s.comment}
          </span>
        ) : (
          <Dash />
        ),
    },
    ...changedColumns<ServiceGridRow>(timeZone),
  ];

  function menu(s: ServiceGridRow): RowMenuItem[] {
    const items: RowMenuItem[] = [{ label: canEdit ? "Edit" : "View", href: viewHref(s) }];
    if (canEdit && !s.is_completed) items.push({ label: "Complete", href: completeHref(s) });
    items.push({
      label: "Copy link",
      onSelect: () => navigator.clipboard?.writeText(`${window.location.origin}${viewHref(s)}`),
    });
    if (canEdit) {
      items.push({
        label: "Delete",
        danger: true,
        confirm: `Service ${s.reference} for ${s.asset_code ?? "this asset"} and its files will be deleted. This can't be undone.`,
        onSelect: async () => {
          setError(null);
          const res = await deleteService(s.id);
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
        spec={open ? openServicesGrid : servicesGrid}
        result={result}
        params={params}
        columns={columns.filter((c) => !open || c.key !== "completed_date")}
        getKey={(s) => s.id}
        title={open ? "Open services" : "Services"}
        timeZone={timeZone}
        rowHref={(s) => (open && canEdit ? completeHref(s) : viewHref(s))}
        rowLabel={(s) => `service ${s.reference}`}
        rowMenu={menu}
        options={{ supplier: options.supplier, changed_by: [...options.users, SYSTEM_OPTION] }}
        emptyLabel={open ? "No open services." : "No services yet."}
      />
    </>
  );
}
