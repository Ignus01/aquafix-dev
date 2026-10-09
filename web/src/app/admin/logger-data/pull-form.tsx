"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { zonedInputToIso } from "@/lib/inspections/dates";
import type { LoggerAsset } from "@/lib/logger-data/types";
import { inputClass, labelClass, primaryButtonClass, sectionHeadingClass } from "../ui";
import { requestPull } from "./actions";

const MAX_DAYS = 7;

// Pulls Hydrus readings for a chosen period (at most 7 days), for every
// active Hydrus logger or the ones picked. The pull runs in the background;
// its progress shows on the Run log tab.
export function PullForm({
  assets,
  timeZone,
  defaultFrom,
  defaultTo,
}: {
  assets: LoggerAsset[];
  timeZone: string;
  defaultFrom: string;
  defaultTo: string;
}) {
  const router = useRouter();
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [scope, setScope] = useState<"all" | "selected">("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const pullable = assets.filter((a) => a.logger_type === "HYDRUS" && a.active);
  const skipped = assets.length - pullable.length;
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return pullable;
    return pullable.filter((a) =>
      [a.name, a.code, a.logger_code, a.location_name ?? ""].some((s) => s.toLowerCase().includes(q)),
    );
  }, [pullable, search]);

  // Checked here for a quick answer; the database checks again.
  const hours = from && to ? (Date.parse(zonedInputToIso(to, timeZone)) - Date.parse(zonedInputToIso(from, timeZone))) / 3_600_000 : 0;
  const rangeError = !from || !to
    ? "Choose a start and an end time."
    : hours <= 0
      ? "The end time must be after the start time."
      : hours > MAX_DAYS * 24
        ? `A pull can cover at most ${MAX_DAYS} days.`
        : null;

  function toggle(id: string) {
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    setError(null);
    if (rangeError) {
      setError(rangeError);
      return;
    }
    if (scope === "selected" && picked.size === 0) {
      setError("Pick at least one asset.");
      return;
    }
    startTransition(async () => {
      const res = await requestPull({
        from,
        to,
        assetIds: scope === "selected" ? [...picked] : [],
        timeZone,
      });
      if (res.error) setError(res.error);
      else router.push(`/admin/logger-data?tab=runs&run=${res.runId}`);
    });
  }

  const count = scope === "all" ? pullable.length : picked.size;

  return (
    <section className="max-w-3xl rounded-card border border-border bg-card">
      <div className="border-b border-border px-5 py-4 md:px-6">
        <h2 className={sectionHeadingClass}>Pull logger data</h2>
        <p className="mt-1 text-[13px] text-muted">
          Fetches readings from the Hydrus API for up to {MAX_DAYS} days. Readings already stored for the same logger
          and time are overwritten. The daily pull at 06:00 covers the previous 24 hours automatically.
        </p>
      </div>

      <div className="flex flex-col gap-5 px-5 py-5 md:px-6">
        <div className="flex flex-wrap gap-4">
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>From</span>
            <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className={`${inputClass} !w-auto`} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={labelClass}>To</span>
            <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className={`${inputClass} !w-auto`} />
          </label>
        </div>
        <span className={`-mt-3 text-xs ${rangeError && from && to ? "text-danger" : "text-muted"}`}>
          {rangeError && from && to
            ? rangeError
            : hours > 0
              ? `${hours >= 48 ? `${Math.round((hours / 24) * 10) / 10} days` : `${Math.round(hours * 10) / 10} hours`} · times in ${timeZone}`
              : `Times in ${timeZone}`}
        </span>

        <fieldset className="flex flex-col gap-2">
          <legend className={`${labelClass} mb-1.5`}>Loggers</legend>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="radio" name="scope" checked={scope === "all"} onChange={() => setScope("all")} className="accent-primary" />
            All active Hydrus loggers ({pullable.length})
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="radio"
              name="scope"
              checked={scope === "selected"}
              onChange={() => setScope("selected")}
              className="accent-primary"
            />
            Selected assets
          </label>
          {skipped > 0 && (
            <span className="text-xs text-muted">
              {skipped} asset{skipped === 1 ? " is" : "s are"} not pulled: inactive, or not a Hydrus logger.
            </span>
          )}
        </fieldset>

        {scope === "selected" && (
          <div className="rounded-control border border-border">
            <div className="flex items-center gap-3 border-b border-border px-3 py-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search assets…"
                aria-label="Search assets"
                className="h-[32px] flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted"
              />
              <span className="text-xs text-muted">{picked.size} selected</span>
            </div>
            <ul className="max-h-72 overflow-y-auto">
              {shown.length === 0 && <li className="px-3 py-4 text-center text-sm text-muted">No matching assets.</li>}
              {shown.map((a) => (
                <li key={a.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-row-hover">
                    <input type="checkbox" checked={picked.has(a.id)} onChange={() => toggle(a.id)} className="accent-primary" />
                    <span className="flex-1 text-ink">
                      {a.name}
                      {a.location_name && <span className="ml-2 text-xs text-muted">{a.location_name}</span>}
                    </span>
                    <span className="font-mono text-[12px] text-muted">{a.logger_code}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && <p className="border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">{error}</p>}
      </div>

      <div className="flex items-center justify-end gap-3 border-t border-border px-5 py-4 md:px-6">
        <button type="button" disabled={isPending || count === 0} onClick={submit} className={primaryButtonClass}>
          {isPending ? "Starting…" : `Pull ${count} logger${count === 1 ? "" : "s"}`}
        </button>
      </div>
    </section>
  );
}
