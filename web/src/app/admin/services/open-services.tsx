import Link from "next/link";
import { formatDate } from "@/lib/incidents/format";
import type { ServiceListRow } from "@/lib/services/types";
import { ChevronRightIcon } from "../icons";
import { ServiceStatusBadge, ServiceTypeBadge } from "./badges";

// Service_Overview_PWA: a gallery of open services. Tapping one opens
// "Complete Service" with Completed already ticked and the date set to now
// (ACT_Service_Complete); nothing is saved until Save.
export function OpenServices({
  services,
  canComplete,
  timeZone,
  now,
}: {
  services: ServiceListRow[];
  canComplete: boolean;
  timeZone: string;
  now: string;
}) {
  if (services.length === 0) {
    return (
      <div className="rounded-card border border-border bg-card px-4 py-10 text-center text-sm text-muted">
        No open services.
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2.5">
      {services.map((s) => (
        <li key={s.id}>
          <Link
            href={canComplete ? `/admin/services/${s.reference}?complete=1` : `/admin/services/${s.reference}`}
            className="flex items-center gap-3 rounded-card border border-border bg-card px-4 py-3.5 transition-colors hover:bg-row-hover"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-ink">
                  {s.asset.code} · {s.asset.name}
                </span>
                <ServiceTypeBadge type={s.service_type} />
                <ServiceStatusBadge completed={false} overdue={s.due_date < now} />
              </div>
              <div className="text-[13px] text-muted">
                Service {s.reference} · Due {formatDate(s.due_date, timeZone)}
              </div>
              {s.comment && <div className="truncate text-[13px] text-ink">{s.comment}</div>}
            </div>
            <ChevronRightIcon className="h-4 w-4 shrink-0 text-muted" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
