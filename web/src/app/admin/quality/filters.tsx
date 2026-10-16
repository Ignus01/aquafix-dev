"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { PERIOD_PRESETS } from "@/lib/dashboard/types";
import { filterParams } from "@/lib/quality/filter";
import type { QualityFilter } from "@/lib/quality/types";

const selectClass =
  "h-[38px] min-w-0 rounded-control border border-border bg-white px-2.5 text-[13px] text-ink outline-none transition-colors focus:border-primary";

const chipClass = (on: boolean) =>
  `h-[32px] rounded-[6px] px-3 text-[13px] font-medium whitespace-nowrap transition-colors ${
    on ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink"
  }`;

type Option = { id: string; name: string };
type LocationOption = Option & { region_id: string; organisation_id: string; active: boolean };

// Lab Results filters, kept in the URL. On the By location tab a location
// is required, so its picker has no "All locations".
export function QualityFilters({
  filter,
  tab,
  today,
  regions,
  organisations,
  locations,
  labs,
  requireLocation,
}: {
  filter: QualityFilter;
  tab: string;
  today: string;
  regions: Option[];
  organisations: Option[];
  locations: LocationOption[];
  labs: Option[];
  requireLocation?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [custom, setCustom] = useState({ from: filter.from, to: filter.to });

  function apply(next: Partial<QualityFilter>) {
    const params = filterParams({ ...filter, ...next });
    if (tab !== "samples") params.set("tab", tab);
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  const siteOptions = locations.filter(
    (l) =>
      (l.active || l.id === filter.location) &&
      (!filter.region || l.region_id === filter.region) &&
      (!filter.organisation || l.organisation_id === filter.organisation),
  );
  const keepLocation = (region: string, organisation: string) => {
    const loc = locations.find((l) => l.id === filter.location);
    return loc && (!region || loc.region_id === region) && (!organisation || loc.organisation_id === organisation)
      ? filter.location
      : "";
  };
  const filtered = Boolean(filter.region || filter.organisation || filter.location || filter.lab || filter.outOfSpec);

  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2.5" aria-busy={pending}>
      <div className="flex max-w-full overflow-x-auto rounded-control bg-black/[.05] p-[3px]" role="group" aria-label="Period">
        {PERIOD_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            aria-pressed={filter.period === p.key}
            className={chipClass(filter.period === p.key)}
            onClick={() => (p.key === "custom" ? apply({ period: "custom", ...custom }) : apply({ period: p.key }))}
          >
            {p.label}
          </button>
        ))}
      </div>

      {filter.period === "custom" && (
        <div className="flex items-center gap-1.5 text-[13px] text-muted">
          <input
            type="date"
            aria-label="From"
            className={selectClass}
            value={custom.from}
            max={custom.to}
            onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
            onBlur={() => custom.from && custom.from !== filter.from && apply({ from: custom.from, to: custom.to })}
          />
          to
          <input
            type="date"
            aria-label="To"
            className={selectClass}
            value={custom.to}
            min={custom.from}
            max={today}
            onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))}
            onBlur={() => custom.to && custom.to !== filter.to && apply({ from: custom.from, to: custom.to })}
          />
        </div>
      )}

      <div className="flex flex-1 flex-wrap items-center gap-2 md:justify-end">
        {regions.length > 0 && (
          <select
            aria-label="Region"
            className={`${selectClass} w-[140px]`}
            value={filter.region}
            onChange={(e) =>
              apply({ region: e.target.value, location: keepLocation(e.target.value, filter.organisation) })
            }
          >
            <option value="">All regions</option>
            {regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label="Organisation"
          className={`${selectClass} w-[160px]`}
          value={filter.organisation}
          onChange={(e) => apply({ organisation: e.target.value, location: keepLocation(filter.region, e.target.value) })}
        >
          <option value="">All organisations</option>
          {organisations.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Location"
          className={`${selectClass} w-[170px]`}
          value={filter.location}
          onChange={(e) => apply({ location: e.target.value })}
        >
          <option value="">{requireLocation ? "Pick a location…" : "All locations"}</option>
          {siteOptions.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Lab"
          className={`${selectClass} w-[150px]`}
          value={filter.lab}
          onChange={(e) => apply({ lab: e.target.value })}
        >
          <option value="">All labs</option>
          {labs.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-pressed={filter.outOfSpec}
          onClick={() => apply({ outOfSpec: !filter.outOfSpec })}
          className={`flex h-[38px] items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium whitespace-nowrap transition-colors ${
            filter.outOfSpec
              ? "border-primary bg-primary/10 text-primary-hover"
              : "border-border bg-white text-ink hover:bg-black/[.02]"
          }`}
        >
          Only out of spec
        </button>
        {filtered && (
          <button
            type="button"
            className="h-[38px] px-2 text-[13px] font-semibold text-primary hover:text-primary-hover"
            onClick={() => apply({ region: "", organisation: "", location: "", lab: "", outOfSpec: false })}
          >
            Clear
          </button>
        )}
        {pending && <span className="text-xs text-muted">Updating…</span>}
      </div>
    </div>
  );
}
