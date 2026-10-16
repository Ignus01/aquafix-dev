"use client";

import { useId, useMemo, useRef, useState } from "react";
import { createParameter } from "../parameters/actions";
import { labParameterName } from "@/lib/quality/evaluate";
import type { QualityParameter } from "@/lib/quality/types";
import { Modal } from "../../modal";
import { Switch } from "../../switch";
import { cellInputClass, inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from "../../ui";

type Option = { value: string; label: string };

// A select with a search box: type to narrow the list, click or Enter to
// pick. `fixed` options (e.g. Ignore) always stay on top.
export function SearchSelect({
  value,
  options,
  fixed = [],
  placeholder,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: Option[];
  fixed?: Option[];
  placeholder: string;
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const all = useMemo(() => [...fixed, ...options], [fixed, options]);
  const selected = all.find((o) => o.value === value);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...fixed, ...(q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options)];
  }, [fixed, options, query]);
  // While searching, the first match is highlighted (not the fixed options).
  const current = Math.min(active, list.length - 1);

  function pick(o: Option) {
    onChange(o.value);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  }

  return (
    <div className="relative min-w-[220px]">
      <input
        ref={inputRef}
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        className={`${cellInputClass} ${selected ? "placeholder:text-ink" : ""}`}
        placeholder={selected?.label ?? placeholder}
        value={open ? query : (selected?.label ?? "")}
        onFocus={() => {
          setOpen(true);
          setActive(0);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(e.target.value.trim() ? fixed.length : 0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive(Math.min(current + 1, list.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive(Math.max(current - 1, 0));
          } else if (e.key === "Enter" && list[current]) {
            e.preventDefault();
            pick(list[current]);
          } else if (e.key === "Escape") {
            setOpen(false);
            inputRef.current?.blur();
          }
        }}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full min-w-[240px] overflow-y-auto rounded-control border border-border bg-white py-1 shadow-lg"
        >
          {list.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(o)}
              className={`cursor-pointer px-3 py-1.5 text-sm ${i === current ? "bg-primary/10" : ""} ${
                o.value === value ? "font-semibold text-primary" : "text-ink"
              } ${i === fixed.length - 1 && fixed.length > 0 && list.length > fixed.length ? "border-b border-border" : ""}`}
            >
              {o.label}
            </li>
          ))}
          {list.length === fixed.length && query && <li className="px-3 py-1.5 text-sm text-muted">No matches</li>}
        </ul>
      )}
    </div>
  );
}

// "+ New parameter…" from the Map step: prefilled with the name after the
// lab's code and the lab's unit.
export function NewParameterModal({
  header,
  unit,
  onClose,
  onCreated,
}: {
  header: string;
  unit: string;
  onClose: () => void;
  onCreated: (p: QualityParameter) => void;
}) {
  const short = labParameterName(header);
  const [values, setValues] = useState<Record<string, string>>({
    name: short,
    short_name: short,
    unit,
    min_acceptable: "",
    max_acceptable: "",
    can_be_negative: "false",
    decimals: "2",
    standard: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((v) => ({ ...v, [key]: e.target.value }));

  async function save() {
    setError(null);
    setSaving(true);
    const res = await createParameter(values);
    setSaving(false);
    if (res.error || !res.parameter) setError(res.error ?? "Couldn't add the parameter.");
    else onCreated(res.parameter);
  }

  const field = (key: string, label: string, type = "text") => (
    <label className="flex flex-col gap-1.5">
      <span className={labelClass}>{label}</span>
      <input className={inputClass} type={type} step={type === "number" ? "any" : undefined} value={values[key]} onChange={set(key)} />
    </label>
  );

  return (
    <Modal
      open
      title={`New parameter for ${header}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={secondaryButtonClass} onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className={primaryButtonClass} onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Add parameter"}
          </button>
        </>
      }
    >
      {error && <p className="mb-4 border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">{error}</p>}
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">{field("name", "Name")}</div>
        {field("short_name", "Short name")}
        {field("unit", "Unit")}
        {field("min_acceptable", "Min acceptable", "number")}
        {field("max_acceptable", "Max acceptable", "number")}
        {field("decimals", "Decimals", "number")}
        {field("standard", "Standard")}
        <div className="col-span-2">
          <Switch
            label="Can be negative (a negative value isn't below detection)"
            checked={values.can_be_negative === "true"}
            onChange={(on) => setValues((v) => ({ ...v, can_be_negative: String(on) }))}
          />
        </div>
      </div>
    </Modal>
  );
}
