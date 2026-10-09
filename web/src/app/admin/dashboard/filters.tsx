"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  PERIOD_PRESETS,
  type FilterOption,
  type LocationFilterOption,
  type PeriodPreset,
} from "@/lib/dashboard/types";

const selectClass =
  "h-[38px] min-w-0 rounded-control border border-border bg-white px-2.5 text-[13px] text-ink outline-none transition-colors focus:border-primary";

const chipClass = (on: boolean) =>
  `h-[32px] rounded-[6px] px-3 text-[13px] font-medium whitespace-nowrap transition-colors ${
    on ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink"
  }`;

export type FilterState = {
  period: PeriodPreset;
  from: string;
  to: string;
  region: string;
  organisation: string;
  location: string;
};

// One row of page-level filters (period + Power BI-style region /
// organisation / site slicers), kept in the URL so a view can be shared.
// `tab` is the home page tab they sit on (none = the default one).
export function DashboardFilters({
  state,
  today,
  tab,
  regions,
  organisations,
  locations,
}: {
  state: FilterState;
  today: string;
  tab?: string;
  regions: FilterOption[];
  organisations: FilterOption[];
  locations: LocationFilterOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [custom, setCustom] = useState({ from: state.from, to: state.to });

  function apply(next: Partial<FilterState>) {
    const merged = { ...state, ...next };
    const params = new URLSearchParams();
    if (tab) params.set("tab", tab);
    if (merged.period !== "90d") params.set("period", merged.period);
    if (merged.period === "custom") {
      params.set("from", merged.from);
      params.set("to", merged.to);
    }
    if (merged.region) params.set("region", merged.region);
    if (merged.organisation) params.set("organisation", merged.organisation);
    if (merged.location) params.set("location", merged.location);
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  // A site outside the chosen region/organisation is dropped.
  const siteOptions = locations.filter(
    (l) =>
      (!state.region || l.region_id === state.region) &&
      (!state.organisation || l.organisation_id === state.organisation),
  );
  const keepLocation = (region: string, organisation: string) => {
    const loc = locations.find((l) => l.id === state.location);
    return loc && (!region || loc.region_id === region) && (!organisation || loc.organisation_id === organisation)
      ? state.location
      : "";
  };
  const filtered = Boolean(state.region || state.organisation || state.location);

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-4 pt-3 pb-1 md:px-8 print:hidden"
      aria-busy={pending}
    >
      <div
        className="flex max-w-full overflow-x-auto rounded-control bg-black/[.05] p-[3px]"
        role="group"
        aria-label="Period"
      >
        {PERIOD_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            aria-pressed={state.period === p.key}
            className={chipClass(state.period === p.key)}
            onClick={() => (p.key === "custom" ? apply({ period: "custom", ...custom }) : apply({ period: p.key }))}
          >
            {p.label}
          </button>
        ))}
      </div>

      {state.period === "custom" && (
        <div className="flex items-center gap-1.5 text-[13px] text-muted">
          <input
            type="date"
            aria-label="From"
            className={selectClass}
            value={custom.from}
            max={custom.to}
            onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))}
            onBlur={() => custom.from && custom.from !== state.from && apply({ from: custom.from, to: custom.to })}
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
            onBlur={() => custom.to && custom.to !== state.to && apply({ from: custom.from, to: custom.to })}
          />
        </div>
      )}

      <div className="flex flex-1 flex-wrap items-center gap-2 md:justify-end">
        <select
          aria-label="Region"
          className={`${selectClass} w-[150px]`}
          value={state.region}
          onChange={(e) =>
            apply({ region: e.target.value, location: keepLocation(e.target.value, state.organisation) })
          }
        >
          <option value="">All regions</option>
          {regions.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Organisation"
          className={`${selectClass} w-[170px]`}
          value={state.organisation}
          onChange={(e) =>
            apply({ organisation: e.target.value, location: keepLocation(state.region, e.target.value) })
          }
        >
          <option value="">All organisations</option>
          {organisations.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Site"
          className={`${selectClass} w-[170px]`}
          value={state.location}
          onChange={(e) => apply({ location: e.target.value })}
        >
          <option value="">All sites</option>
          {siteOptions.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        {filtered && (
          <button
            type="button"
            className="h-[38px] px-2 text-[13px] font-semibold text-primary hover:text-primary-hover"
            onClick={() => apply({ region: "", organisation: "", location: "" })}
          >
            Clear
          </button>
        )}
        {pending && <span className="text-xs text-muted">Updating…</span>}
      </div>
    </div>
  );
}
