"use client";

import { useEffect, useRef, useState } from "react";
import { formatPlainDate, todayInZone } from "@/lib/inspections/dates";
import { BLANK, NUMBER_OPS, type ChoiceOption, type FilterValue, type GridField, type NumberOp } from "@/lib/grid/types";
import { Popover } from "./popover";

// One control per filter type, in the filter row under the header.
//   text      contains, debounced
//   choice    any of, in a multi-select popover
//   date      a day range, with presets
//   number    =, ≠, >, ≥, <, ≤

const DEBOUNCE_MS = 300;

export const filterControlClass =
  "h-8 rounded-control border bg-white px-2 text-[13px] text-ink outline-none transition-colors placeholder:text-muted focus:border-primary";

const borderFor = (active: boolean) => (active ? "border-primary" : "border-border");

type FilterProps = {
  field: GridField;
  value: FilterValue | undefined;
  onChange: (value: FilterValue | null) => void;
};

// Local text that follows the URL value, without clobbering what the user
// is still typing when an older request's result comes back.
function useDebouncedText(external: string, send: (text: string) => void) {
  const [text, setText] = useState(external);
  const [seen, setSeen] = useState(external);
  const [sent, setSent] = useState(external);
  if (external !== seen) {
    setSeen(external);
    if (external !== sent) {
      setText(external);
      setSent(external);
    }
  }
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });
  useEffect(() => {
    if (text.trim() === sent.trim()) return;
    const t = setTimeout(() => {
      setSent(text);
      sendRef.current(text);
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text, sent]);
  return [text, setText] as const;
}

export function TextFilter({ field, value, onChange }: FilterProps) {
  const external = value?.kind === "text" ? value.value : "";
  const [text, setText] = useDebouncedText(external, (t) =>
    onChange(t.trim() ? { kind: "text", value: t.trim() } : null),
  );
  return (
    <input
      type="search"
      aria-label={`Filter ${field.label}`}
      placeholder="Contains…"
      value={text}
      onChange={(e) => setText(e.target.value)}
      className={`${filterControlClass} ${borderFor(external !== "")} w-full min-w-[110px]`}
    />
  );
}

const OP_SYMBOLS: Record<NumberOp, { symbol: string; title: string }> = {
  eq: { symbol: "=", title: "Equal to" },
  ne: { symbol: "≠", title: "Not equal to" },
  gt: { symbol: ">", title: "Greater than" },
  ge: { symbol: "≥", title: "Greater than or equal to" },
  lt: { symbol: "<", title: "Less than" },
  le: { symbol: "≤", title: "Less than or equal to" },
};

export function NumberFilter({ field, value, onChange }: FilterProps) {
  const current = value?.kind === "number" ? value : null;
  const [op, setOp] = useState<NumberOp>(current?.op ?? "eq");
  const [seenOp, setSeenOp] = useState(current?.op);
  if (current?.op !== seenOp) {
    setSeenOp(current?.op);
    if (current) setOp(current.op);
  }
  const external = current ? String(current.value) : "";
  const send = (t: string, o: NumberOp) => {
    const n = Number(t.trim());
    onChange(t.trim() !== "" && Number.isFinite(n) ? { kind: "number", op: o, value: n } : null);
  };
  const [text, setText] = useDebouncedText(external, (t) => send(t, op));
  return (
    <div className="flex min-w-[110px]">
      <select
        aria-label={`${field.label} comparison`}
        title={OP_SYMBOLS[op].title}
        value={op}
        onChange={(e) => {
          const o = e.target.value as NumberOp;
          setOp(o);
          if (text.trim() !== "") send(text, o);
        }}
        className={`${filterControlClass} ${borderFor(current !== null)} w-10 shrink-0 rounded-r-none border-r-0 px-1 text-center`}
      >
        {NUMBER_OPS.map((o) => (
          <option key={o} value={o} title={OP_SYMBOLS[o].title}>
            {OP_SYMBOLS[o].symbol}
          </option>
        ))}
      </select>
      <input
        type="number"
        step="any"
        inputMode="decimal"
        aria-label={`Filter ${field.label}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className={`${filterControlClass} ${borderFor(current !== null)} w-full min-w-0 rounded-l-none`}
      />
    </div>
  );
}

function FilterButton({
  active,
  label,
  summary,
  onClick,
  buttonRef,
  expanded,
}: {
  active: boolean;
  label: string;
  summary: string;
  onClick: () => void;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  expanded: boolean;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={`Filter ${label}: ${summary}`}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      onClick={onClick}
      className={`${filterControlClass} ${borderFor(active)} flex w-full min-w-[110px] items-center justify-between gap-1 text-left ${
        active ? "" : "text-muted"
      }`}
    >
      <span className="truncate">{summary}</span>
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true">
        <path d="M5.5 7.5 10 12l4.5-4.5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      </svg>
    </button>
  );
}

export function choiceSummary(values: string[], options: ChoiceOption[]) {
  if (values.length === 0) return "All";
  if (values.length > 1) return `${values.length} selected`;
  return options.find((o) => o.value === values[0])?.label ?? (values[0] === BLANK ? "(blank)" : "1 selected");
}

export function ChoiceFilter({ field, value, onChange, options }: FilterProps & { options: ChoiceOption[] }) {
  const selected = value?.kind === "choice" ? value.values : [];
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const button = useRef<HTMLButtonElement>(null);
  const shown = search
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  function toggle(v: string) {
    const next = selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v];
    onChange(next.length ? { kind: "choice", values: next } : null);
  }

  return (
    <>
      <FilterButton
        buttonRef={button}
        active={selected.length > 0}
        label={field.label}
        summary={choiceSummary(selected, options)}
        expanded={open}
        onClick={() => setOpen((o) => !o)}
      />
      <Popover anchor={button} open={open} onClose={() => setOpen(false)} role="dialog" label={`Filter ${field.label}`} className="w-64 p-2">
        {options.length > 8 && (
          <input
            type="search"
            autoFocus
            placeholder="Search…"
            aria-label={`Search ${field.label} options`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${filterControlClass} border-border mb-2 w-full`}
          />
        )}
        <div className="max-h-64 overflow-y-auto">
          {shown.length === 0 && <p className="px-2 py-3 text-center text-[13px] text-muted">No options</p>}
          {shown.map((o) => (
            <label
              key={o.value}
              className="flex cursor-pointer items-center gap-2 rounded-control px-2 py-1.5 text-[13px] text-ink hover:bg-row-hover"
            >
              <input
                type="checkbox"
                checked={selected.includes(o.value)}
                onChange={() => toggle(o.value)}
                className="h-3.5 w-3.5 accent-[var(--color-primary)]"
              />
              <span className={`truncate ${o.value === BLANK ? "italic text-muted" : ""}`}>{o.label}</span>
            </label>
          ))}
        </div>
        {selected.length > 0 && (
          <div className="mt-1 border-t border-border pt-1.5 text-right">
            <button
              type="button"
              onClick={() => onChange(null)}
              className="px-2 text-xs font-semibold text-primary hover:text-primary-hover"
            >
              Clear
            </button>
          </div>
        )}
      </Popover>
    </>
  );
}

function addDaysYmd(ymd: string, days: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function monthStart(ymd: string, offset = 0) {
  const [y, m] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + offset, 1)).toISOString().slice(0, 10);
}

type Preset = { label: string; range: (today: string) => [string | null, string | null] };

const PRESETS: Preset[] = [
  { label: "Today", range: (t) => [t, t] },
  { label: "Last 7 days", range: (t) => [addDaysYmd(t, -6), t] },
  { label: "This month", range: (t) => [monthStart(t), addDaysYmd(monthStart(t, 1), -1)] },
  { label: "Last month", range: (t) => [monthStart(t, -1), addDaysYmd(monthStart(t), -1)] },
];
// Due dates only: everything before today.
const OVERDUE: Preset = { label: "Overdue", range: (t) => [null, addDaysYmd(t, -1)] };

export function dateSummary(from: string | null, to: string | null, today?: string) {
  if (!from && !to) return "Any date";
  if (today) {
    for (const p of [...PRESETS, OVERDUE]) {
      const [f, t] = p.range(today);
      if (f === from && t === to) return p.label;
    }
  }
  if (from && from === to) return formatPlainDate(from);
  if (!to) return `From ${formatPlainDate(from)}`;
  if (!from) return `Until ${formatPlainDate(to)}`;
  return `${formatPlainDate(from)} – ${formatPlainDate(to)}`;
}

export function DateFilter({ field, value, onChange, timeZone }: FilterProps & { timeZone: string }) {
  const current = value?.kind === "date" || value?.kind === "datetime" ? value : null;
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(current?.from ?? "");
  const [to, setTo] = useState(current?.to ?? "");
  const button = useRef<HTMLButtonElement>(null);
  const today = todayInZone(timeZone);
  const kind = field.filter === "datetime" ? "datetime" : "date";
  const presets = kind === "date" ? [...PRESETS, OVERDUE] : PRESETS;

  function apply(f: string | null, t: string | null) {
    onChange(f || t ? { kind, from: f || null, to: t || null } : null);
    setOpen(false);
  }

  return (
    <>
      <FilterButton
        buttonRef={button}
        active={current !== null}
        label={field.label}
        summary={current ? dateSummary(current.from, current.to, today) : "Any date"}
        expanded={open}
        onClick={() => {
          setFrom(current?.from ?? "");
          setTo(current?.to ?? "");
          setOpen((o) => !o);
        }}
      />
      <Popover anchor={button} open={open} onClose={() => setOpen(false)} role="dialog" label={`Filter ${field.label}`} className="w-64 p-3">
        <div className="mb-3 flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => apply(...p.range(today))}
              className="rounded-full border border-border px-2.5 py-1 text-xs font-medium text-ink transition-colors hover:border-primary hover:text-primary"
            >
              {p.label}
            </button>
          ))}
        </div>
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            // A reversed range is almost always a slip: swap it.
            if (from && to && from > to) apply(to, from);
            else apply(from, to);
          }}
        >
          <label className="flex items-center justify-between gap-2 text-xs text-muted">
            From
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${filterControlClass} border-border w-40`} />
          </label>
          <label className="flex items-center justify-between gap-2 text-xs text-muted">
            To
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${filterControlClass} border-border w-40`} />
          </label>
          <div className="mt-1 flex justify-end gap-3">
            {current && (
              <button type="button" onClick={() => apply(null, null)} className="text-xs font-semibold text-muted hover:text-ink">
                Clear
              </button>
            )}
            <button type="submit" className="rounded-control bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-hover">
              Apply
            </button>
          </div>
        </form>
      </Popover>
    </>
  );
}
