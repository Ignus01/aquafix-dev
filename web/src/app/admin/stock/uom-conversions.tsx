"use client";

import { useEffect, useState, useTransition } from "react";
import { PlusIcon } from "../icons";
import {
  cellInputClass,
  dangerLinkButtonClass,
  linkButtonClass,
  sectionHeadingClass,
  smallPrimaryButtonClass,
  tableHeadCellClass,
} from "../ui";
import type { UnitOfMeasure, UomConversion } from "@/lib/stock/types";
import {
  createConversion,
  deleteConversion,
  listConversions,
  updateConversion,
} from "./actions";

type Ctx =
  | { mode: "add"; saveFirst: () => Promise<string | null> }
  | { mode: "edit"; id: string };

// Conversions that start from this unit of measure: "1 <from> = <n> <to>".
// Saving one also writes the opposite direction (1 / n), and deleting one
// removes both, so only this unit's own rows are listed. Changes save
// immediately, like the other drawer grids.
export function UomConversions({
  ctx,
  units,
  canEdit,
}: {
  ctx: Ctx;
  units: UnitOfMeasure[];
  canEdit: boolean;
}) {
  const fromId = ctx.mode === "edit" ? ctx.id : null;
  const from = units.find((u) => u.id === fromId);
  const [rows, setRows] = useState<UomConversion[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [to, setTo] = useState("");
  const [factor, setFactor] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!fromId) return;
    let cancelled = false;
    listConversions(fromId).then((r) => {
      if (!cancelled) setRows(r);
    });
    return () => {
      cancelled = true;
    };
  }, [fromId]);

  const used = new Set((rows ?? []).map((r) => r.to_uom_id));
  const pickable = units.filter((u) => u.active && u.id !== fromId && (!used.has(u.id) || (editing !== null && u.id === to)));

  function reset() {
    setEditing(null);
    setTo("");
    setFactor("");
  }

  function save() {
    setError(null);
    startTransition(async () => {
      // Like the other popups' "+" on a new record: save the unit first.
      const id = ctx.mode === "add" ? await ctx.saveFirst() : ctx.id;
      if (!id) return;
      const res = editing
        ? await updateConversion(editing, factor)
        : await createConversion(id, to, factor);
      if (res.error) {
        setError(res.error);
        return;
      }
      reset();
      setRows(await listConversions(id));
    });
  }

  function remove(row: UomConversion) {
    if (!fromId) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteConversion(row.id);
      if (res.error) setError(res.error);
      setRows(await listConversions(fromId));
    });
  }

  return (
    <section className="mt-8 overflow-hidden rounded-card border border-border">
      <div className="border-b border-border px-4 py-2.5">
        <h3 className={sectionHeadingClass}>Conversions</h3>
        <p className="mt-0.5 text-[11px] text-muted">
          {canEdit
            ? "Changes here save immediately. The opposite conversion is kept in step."
            : "Only admins can change conversions."}
        </p>
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <span className="text-[13px] text-ink">1 {from?.code ?? "unit"} =</span>
          <input
            aria-label="Conversion factor"
            type="number"
            min="0"
            step="any"
            className={`${cellInputClass} w-28`}
            value={factor}
            onChange={(e) => setFactor(e.target.value)}
          />
          <select
            aria-label="Convert to"
            className={`${cellInputClass} w-44`}
            value={to}
            disabled={editing !== null}
            onChange={(e) => setTo(e.target.value)}
          >
            <option value="">Convert to…</option>
            {pickable.map((u) => (
              <option key={u.id} value={u.id}>
                {u.code} — {u.name}
              </option>
            ))}
          </select>
          <button
            disabled={isPending || !factor || (!editing && !to)}
            onClick={save}
            className={smallPrimaryButtonClass}
          >
            {!editing && <PlusIcon className="h-3.5 w-3.5" />}
            {editing ? "Update" : "Add"}
          </button>
          {editing && (
            <button onClick={reset} className={linkButtonClass}>
              Cancel
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="mx-4 mt-3 border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">
          {error}
        </p>
      )}

      {ctx.mode === "add" ? (
        <p className="px-4 py-6 text-center text-[13px] text-muted">
          No conversions yet.{canEdit && " Adding one saves this unit of measure first."}
        </p>
      ) : rows === null ? (
        <p className="px-4 py-6 text-center text-[13px] text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-[13px] text-muted">No conversions yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-table-head">
              <th className={tableHeadCellClass}>Code</th>
              <th className={tableHeadCellClass}>Conversion</th>
              {canEdit && <th className={tableHeadCellClass} />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="h-[44px] border-t border-border">
                <td className="px-3 font-mono text-[13px] text-muted">{r.code}</td>
                <td className="px-3 text-ink">
                  1 {from?.code} = {r.conversion} {r.to_uom?.code}
                </td>
                {canEdit && (
                  <td className="px-3 text-right whitespace-nowrap">
                    <div className="flex justify-end gap-4">
                      <button
                        disabled={isPending}
                        onClick={() => {
                          setEditing(r.id);
                          setTo(r.to_uom_id);
                          setFactor(String(r.conversion));
                        }}
                        className={linkButtonClass}
                      >
                        Edit
                      </button>
                      <button
                        disabled={isPending}
                        onClick={() => remove(r)}
                        className={dangerLinkButtonClass}
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
