"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { formatDate, formatDateTime } from "@/lib/incidents/format";
import { SERVICE_TYPE_LABELS, type ServiceListRow } from "@/lib/services/types";
import { DataTable, type Column } from "../inspections/data-table";
import { dangerLinkButtonClass, linkButtonClass } from "../ui";
import { ServiceStatusBadge, ServiceTypeBadge } from "./badges";
import { deleteService } from "./actions";
import { formatMoney } from "./format";

// Service_Overview: the data grid of all services, with search, Export and a
// per-row Edit (writers) or View (viewers).
export function ServicesGrid({
  services,
  canEdit,
  timeZone,
  now,
}: {
  services: ServiceListRow[];
  canEdit: boolean;
  timeZone: string;
  // Server render time, so "overdue" agrees between server and browser.
  now: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function remove(service: ServiceListRow) {
    if (!window.confirm(`Delete service ${service.reference} for ${service.asset.code}? Its files are deleted too.`)) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await deleteService(service.id);
      if (res.error) setError(res.error);
    });
  }

  const money = "whitespace-nowrap text-right text-ink tabular-nums";
  const columns: Column<ServiceListRow>[] = [
    { key: "uid", label: "UID", render: (s) => <span className="font-semibold">{s.reference}</span>, text: (s) => s.reference },
    { key: "asset", label: "Asset code", render: (s) => s.asset.code, text: (s) => `${s.asset.code} ${s.asset.name}` },
    {
      key: "due",
      label: "Due date",
      render: (s) => formatDate(s.due_date, timeZone),
      text: (s) => formatDate(s.due_date, timeZone),
      sortValue: (s) => s.due_date,
    },
    {
      key: "type",
      label: "Service type",
      render: (s) => <ServiceTypeBadge type={s.service_type} />,
      text: (s) => SERVICE_TYPE_LABELS[s.service_type],
    },
    {
      key: "status",
      label: "Completed",
      render: (s) => (
        <ServiceStatusBadge completed={s.is_completed} overdue={!s.is_completed && s.due_date < now} />
      ),
      text: (s) => (s.is_completed ? "Yes" : "No"),
    },
    {
      key: "completed_date",
      label: "Completed date",
      render: (s) => formatDateTime(s.completed_date, timeZone),
      text: (s) => (s.completed_date ? formatDateTime(s.completed_date, timeZone) : ""),
      sortValue: (s) => s.completed_date,
    },
    { key: "supplier", label: "Supplier", render: (s) => s.supplier?.name ?? "—", text: (s) => s.supplier?.name ?? "" },
    { key: "performed_by", label: "Performed by", render: (s) => s.performed_by ?? "—", text: (s) => s.performed_by ?? "" },
    { key: "invoice", label: "Invoice nr", render: (s) => s.invoice_nr ?? "—", text: (s) => s.invoice_nr ?? "" },
    {
      key: "part",
      label: "Part cost",
      className: money,
      render: (s) => (s.is_completed ? formatMoney(s.total_part_cost) : "—"),
      text: (s) => (s.is_completed ? s.total_part_cost : null),
    },
    {
      key: "labour",
      label: "Labour cost",
      className: money,
      render: (s) => (s.is_completed ? formatMoney(s.total_labour_cost) : "—"),
      text: (s) => (s.is_completed ? s.total_labour_cost : null),
    },
    {
      key: "total",
      label: "Total cost",
      className: `${money} font-semibold`,
      render: (s) => (s.is_completed ? formatMoney(s.total_cost) : "—"),
      text: (s) => (s.is_completed ? s.total_cost : null),
    },
    {
      key: "comment",
      label: "Comment",
      className: "max-w-[260px] truncate text-ink",
      render: (s) => s.comment ?? "—",
      text: (s) => s.comment ?? "",
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {error && <p className="border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">{error}</p>}
      <DataTable
        rows={services}
        columns={columns}
        getKey={(s) => s.id}
        emptyLabel="No services yet."
        searchPlaceholder="Search services…"
        exportName="services"
        actions={(s) => (
          <span className="inline-flex items-center gap-4">
            <Link href={`/admin/services/${s.reference}`} className={linkButtonClass}>
              {canEdit ? "Edit" : "View"}
            </Link>
            {canEdit && (
              <button type="button" disabled={isPending} onClick={() => remove(s)} className={dangerLinkButtonClass}>
                Delete
              </button>
            )}
          </span>
        )}
      />
    </div>
  );
}
