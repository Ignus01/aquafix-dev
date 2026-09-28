"use client";

import { useMemo, useState } from "react";
import type { AssetOption } from "@/lib/inspections/types";
import { Modal } from "../modal";
import { SearchIcon } from "../icons";
import { StatusBadge } from "../status-badge";
import { primaryButtonClass, secondaryButtonClass, tableHeadCellClass } from "../ui";

// ScheduledInstruction_SelectAsset / Instruction_AllocateAsset (SCH-R08,
// INS-R04): every asset, inactive ones included, sorted by name. The
// selection replaces the list on "Save & Close"; nothing is saved until the
// schedule's or instruction's own Save. `locked` assets (already inspected)
// can't be deselected.
export function AssetPicker({
  open,
  assets,
  selected,
  locked = [],
  onClose,
  onSave,
}: {
  open: boolean;
  assets: AssetOption[];
  selected: string[];
  locked?: string[];
  onClose: () => void;
  onSave: (ids: string[]) => void;
}) {
  const [picked, setPicked] = useState(() => new Set(selected));
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return assets;
    return assets.filter((a) =>
      [a.name, a.code, a.asset_type.name, a.location.name].some((v) => v.toLowerCase().includes(q)),
    );
  }, [assets, query]);

  const lockedSet = new Set(locked);

  function toggle(id: string) {
    if (lockedSet.has(id)) return;
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // "Select": every row currently shown (the Mendix grid selection).
  function selectShown() {
    setPicked((prev) => new Set([...prev, ...filtered.map((a) => a.id)]));
  }

  // "Deselect All" (inspected assets stay).
  function deselectAll() {
    setPicked(new Set(locked));
  }

  return (
    <Modal
      open={open}
      title="Select assets"
      width={820}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto text-[13px] text-muted">{picked.size} selected</span>
          <button type="button" className={secondaryButtonClass} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={primaryButtonClass} onClick={() => onSave([...picked])}>
            Save &amp; Close
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex h-[38px] flex-1 items-center gap-2 rounded-full border border-border bg-white px-3 text-muted">
            <SearchIcon className="h-4 w-4 shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, code, type or location…"
              className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted"
            />
          </label>
          <button type="button" className={`${secondaryButtonClass} !h-[38px]`} onClick={selectShown}>
            Select {query ? "shown" : "all"}
          </button>
          <button type="button" className={`${secondaryButtonClass} !h-[38px]`} onClick={deselectAll}>
            Deselect All
          </button>
        </div>

        <div className="max-h-[50vh] overflow-auto rounded-control border border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0">
              <tr className="bg-table-head">
                <th className={`${tableHeadCellClass} w-10`} />
                <th className={tableHeadCellClass}>Name</th>
                <th className={tableHeadCellClass}>Code</th>
                <th className={tableHeadCellClass}>Asset type</th>
                <th className={tableHeadCellClass}>Location</th>
                <th className={tableHeadCellClass}>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-muted">
                    No assets match.
                  </td>
                </tr>
              )}
              {filtered.map((a) => {
                const isLocked = lockedSet.has(a.id);
                return (
                  <tr
                    key={a.id}
                    onClick={() => toggle(a.id)}
                    className={`border-t border-border transition-colors ${
                      isLocked ? "" : "cursor-pointer hover:bg-row-hover"
                    } ${picked.has(a.id) ? "bg-primary/[.04]" : ""}`}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Select ${a.name}`}
                        checked={picked.has(a.id)}
                        disabled={isLocked}
                        onChange={() => toggle(a.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="h-4 w-4 accent-[var(--color-primary)]"
                      />
                    </td>
                    <td className="px-3 py-2 font-medium text-ink">
                      {a.name}
                      {isLocked && <span className="ml-2 text-xs font-normal text-muted">Inspected</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-[12px] text-muted">{a.code}</td>
                    <td className="px-3 py-2 text-ink">{a.asset_type.name}</td>
                    <td className="px-3 py-2 text-ink">{a.location.name}</td>
                    <td className="px-3 py-2">
                      <StatusBadge active={a.active} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

// The "Assets Allocated" / "Assets Instructed" grid inside an editor.
export function AssetList({
  assets,
  ids,
  locked = [],
  readOnly,
  onRemove,
  onAdd,
}: {
  assets: AssetOption[];
  ids: string[];
  locked?: string[];
  readOnly?: boolean;
  onRemove: (id: string) => void;
  onAdd: () => void;
}) {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const rows = ids
    .map((id) => byId.get(id))
    .filter((a): a is AssetOption => Boolean(a))
    .sort((a, b) => a.name.localeCompare(b.name));
  const lockedSet = new Set(locked);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold tracking-wider text-muted uppercase">
          Assets <span className="ml-1 font-normal normal-case">({rows.length})</span>
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={onAdd}
            className="h-[32px] rounded-control border border-border bg-white px-3 text-[13px] font-semibold text-ink transition-colors hover:bg-black/[.03]"
          >
            Add assets
          </button>
        )}
      </div>
      <div className="overflow-hidden rounded-control border border-border">
        {rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-[13px] text-muted">No assets yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-table-head">
                <th className={tableHeadCellClass}>Name</th>
                <th className={tableHeadCellClass}>Code</th>
                <th className={tableHeadCellClass}>Asset type</th>
                <th className={tableHeadCellClass}>Location</th>
                {!readOnly && <th className={tableHeadCellClass} />}
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} className="border-t border-border">
                  <td className="px-3 py-2 text-ink">
                    {a.name}
                    {!a.active && <span className="ml-2 text-xs text-muted">(inactive)</span>}
                  </td>
                  <td className="px-3 py-2 font-mono text-[12px] text-muted">{a.code}</td>
                  <td className="px-3 py-2 text-ink">{a.asset_type.name}</td>
                  <td className="px-3 py-2 text-ink">{a.location.name}</td>
                  {!readOnly && (
                    <td className="px-3 py-2 text-right">
                      {lockedSet.has(a.id) ? (
                        <span className="text-xs text-muted">Inspected</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onRemove(a.id)}
                          className="text-xs font-semibold text-danger hover:opacity-80"
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
