"use client";

import { useState } from "react";
import type { TargetBand, TargetBandColour } from "@/lib/masterdata/types";
import { XIcon } from "../icons";
import { cellInputClass, inputClass, linkButtonClass } from "../ui";
import {
  BAND_COLOUR_LABELS,
  BAND_STYLES,
  DEFAULT_TARGET_BANDS,
  MAX_TARGET_BANDS,
  bandSummary,
  parseBands,
  sortBands,
  targetBandsError,
} from "../dashboard/water-format";

// The Location form's Water section: the daily volume target and its colour
// bands. Bands travel in the form as a JSON string under `target_bands`.

const COLOURS = Object.keys(BAND_COLOUR_LABELS) as TargetBandColour[];

// The target in m³ per day. Entering one when the location has no bands
// pre-fills the default set.
export function TargetInput({
  value,
  values,
  setValue,
}: {
  value: string;
  values: Record<string, string>;
  setValue: (key: string, v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        className={inputClass}
        type="number"
        inputMode="decimal"
        min="0.01"
        step="0.01"
        placeholder="No target"
        value={value}
        // Scrolling the drawer shouldn't change the number.
        onWheel={(e) => e.currentTarget.blur()}
        onChange={(e) => {
          const v = e.target.value;
          setValue("volume_target", v);
          if (v.trim() && parseBands(values.target_bands).length === 0) {
            setValue("target_bands", JSON.stringify(DEFAULT_TARGET_BANDS));
          }
        }}
      />
      <span className="shrink-0 text-sm text-muted">m³ / day</span>
    </div>
  );
}

export function BandEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const bands = parseBands(value);
  // From values as typed, so a half-typed number isn't rewritten.
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const set = (next: TargetBand[]) => onChange(JSON.stringify(next));
  const update = (i: number, patch: Partial<TargetBand>) =>
    set(bands.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  // Highest From first once the user leaves the field.
  const resort = () => {
    setDrafts({});
    set(sortBands(bands));
  };

  const error = targetBandsError(bands);
  const complete = bands.every((b) => Number.isFinite(b.from_pct) && b.colour);

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-control border border-border">
        <table className="w-full text-sm">
          <thead className="bg-table-head">
            <tr className="text-left text-[11px] font-semibold tracking-wider text-muted uppercase">
              <th className="w-[92px] px-2 py-1.5 font-semibold">From (%)</th>
              <th className="w-[132px] px-2 py-1.5 font-semibold">Colour</th>
              <th className="px-2 py-1.5 font-semibold">Label</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {bands.map((b, i) => (
              <tr key={i} className="border-t border-border">
                <td className="px-2 py-1.5">
                  <input
                    className={`${cellInputClass} text-right font-mono tabular-nums`}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    aria-label={`Band ${i + 1} from (%)`}
                    value={drafts[i] ?? (Number.isFinite(b.from_pct) ? String(b.from_pct) : "")}
                    onChange={(e) => {
                      setDrafts((d) => ({ ...d, [i]: e.target.value }));
                      update(i, { from_pct: e.target.value === "" ? NaN : Number(e.target.value) });
                    }}
                    onBlur={resort}
                    onWheel={(e) => e.currentTarget.blur()}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="h-4 w-4 shrink-0 rounded-[4px] border border-black/10"
                      style={{ background: b.colour ? BAND_STYLES[b.colour].swatch : "transparent" }}
                    />
                    <select
                      className={cellInputClass}
                      aria-label={`Band ${i + 1} colour`}
                      value={b.colour ?? ""}
                      onChange={(e) => update(i, { colour: e.target.value as TargetBandColour })}
                    >
                      {COLOURS.map((c) => (
                        <option key={c} value={c}>
                          {BAND_COLOUR_LABELS[c]}
                        </option>
                      ))}
                    </select>
                  </div>
                </td>
                <td className="px-2 py-1.5">
                  <input
                    className={cellInputClass}
                    aria-label={`Band ${i + 1} label`}
                    placeholder="Optional"
                    maxLength={60}
                    value={b.label ?? ""}
                    onChange={(e) => update(i, { label: e.target.value })}
                  />
                </td>
                <td className="pr-2 text-right">
                  <button
                    type="button"
                    aria-label={`Remove band ${i + 1}`}
                    onClick={() => {
                      setDrafts({});
                      set(bands.filter((_, j) => j !== i));
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-black/[.05] hover:text-danger"
                  >
                    <XIcon className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <button
          type="button"
          className={linkButtonClass}
          disabled={bands.length >= MAX_TARGET_BANDS}
          onClick={() => {
            setDrafts({});
            // Halfway below the lowest band above 0%.
            const lowest = Math.min(...bands.map((b) => b.from_pct).filter((n) => n > 0), 100);
            set(sortBands([...bands, { from_pct: Math.round(lowest / 2), colour: "grey", label: null }]));
          }}
        >
          Add band
        </button>
        {bands.length === 0 && (
          <button type="button" className={linkButtonClass} onClick={() => set(DEFAULT_TARGET_BANDS)}>
            Use the default bands
          </button>
        )}
        <span className="text-xs text-muted">
          A band runs from its % up to the next band&rsquo;s. At most {MAX_TARGET_BANDS}.
        </span>
      </div>
      {complete && bands.length > 0 && (
        <p className="text-xs text-muted">
          <span className="font-semibold text-ink">Preview:</span> {bandSummary(bands)}
        </p>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
