"use client";

import { useEffect, useState, useTransition } from "react";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon } from "../icons";
import {
  cellInputClass,
  dangerLinkButtonClass,
  sectionHeadingClass,
  smallPrimaryButtonClass,
  tableHeadCellClass,
} from "../ui";
import type { AssetTypeAllocation } from "@/lib/inspection-setup/types";
import {
  createAssetTypeAllocation,
  deleteAllocation,
  listAssetTypeAllocations,
  reorderAssetTypeAllocations,
} from "./actions";

type Ctx =
  | { mode: "add"; saveFirst: () => Promise<string | null> }
  | { mode: "edit"; id: string };

// The InspectionAllocation grid on Masterdata.AssetType_NewEdit: which
// inspections apply to this asset type, in priority order. Writes go straight
// to the database (admin-only, per the InspectionSetup access matrix).
export function AssetTypeInspections({
  ctx,
  inspections,
  canEdit,
}: {
  ctx: Ctx;
  inspections: { id: string; name: string; active: boolean }[];
  canEdit: boolean;
}) {
  const assetTypeId = ctx.mode === "edit" ? ctx.id : null;
  const [rows, setRows] = useState<AssetTypeAllocation[] | null>(null);
  const [pick, setPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!assetTypeId) return;
    let cancelled = false;
    listAssetTypeAllocations(assetTypeId).then((r) => {
      if (!cancelled) setRows(r);
    });
    return () => {
      cancelled = true;
    };
  }, [assetTypeId]);

  const allocated = new Set((rows ?? []).map((r) => r.inspection_id));
  // Only active inspections can be picked (the popup's `[Active]` filter).
  const pickable = inspections.filter((i) => i.active && !allocated.has(i.id));

  function add() {
    if (!pick) return;
    setError(null);
    startTransition(async () => {
      // Like the Asset Type page's "+" on a new record: save the asset type first.
      const id = ctx.mode === "add" ? await ctx.saveFirst() : ctx.id;
      if (!id) return;
      const res = await createAssetTypeAllocation(id, pick);
      if (res.error) {
        setError(res.error);
        return;
      }
      setPick("");
      setRows(await listAssetTypeAllocations(id));
    });
  }

  function move(index: number, delta: -1 | 1) {
    if (!rows || !assetTypeId) return;
    const next = [...rows];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    const renumbered = next.map((r, n) => ({ ...r, priority: n + 1 }));
    setRows(renumbered);
    setError(null);
    startTransition(async () => {
      const res = await reorderAssetTypeAllocations(
        assetTypeId,
        renumbered.map((r) => r.id),
      );
      if (res.error) setError(res.error);
      setRows(await listAssetTypeAllocations(assetTypeId));
    });
  }

  function remove(row: AssetTypeAllocation) {
    if (!assetTypeId) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteAllocation(row.id);
      if (res.error) setError(res.error);
      setRows(await listAssetTypeAllocations(assetTypeId));
    });
  }

  return (
    <section className="mt-8 overflow-hidden rounded-card border border-border">
      <div className="flex min-h-[52px] items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div>
          <h3 className={sectionHeadingClass}>Inspections</h3>
          <p className="mt-0.5 text-[11px] text-muted">
            {canEdit
              ? "Changes here save immediately."
              : "Only admins can change inspection allocations."}
          </p>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <select
              aria-label="Inspection to allocate"
              className={`${cellInputClass} w-48`}
              value={pick}
              onChange={(e) => setPick(e.target.value)}
            >
              <option value="">Select inspection…</option>
              {pickable.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
            <button
              disabled={!pick || isPending}
              onClick={add}
              className={smallPrimaryButtonClass}
            >
              <PlusIcon className="h-3.5 w-3.5" />
              Add
            </button>
          </div>
        )}
      </div>

      {error && (
        <p className="mx-4 mt-3 border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">
          {error}
        </p>
      )}

      {ctx.mode === "add" ? (
        <p className="px-4 py-6 text-center text-[13px] text-muted">
          No inspections allocated yet.
          {canEdit && " Adding one saves this asset type first."}
        </p>
      ) : rows === null ? (
        <p className="px-4 py-6 text-center text-[13px] text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-[13px] text-muted">
          No inspections allocated yet.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-table-head">
              <th className={`${tableHeadCellClass} w-24`}>Priority</th>
              <th className={tableHeadCellClass}>Inspection</th>
              {canEdit && <th className={tableHeadCellClass} />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className="h-[44px] border-t border-border">
                <td className="px-3">
                  <div className="flex items-center gap-1">
                    <span className="w-5 font-mono text-[13px] text-muted">{r.priority}</span>
                    {canEdit && (
                      <>
                        <button
                          aria-label="Move up"
                          disabled={i === 0 || isPending}
                          onClick={() => move(i, -1)}
                          className="rounded-control p-1 text-muted transition-colors hover:bg-black/[.05] hover:text-ink disabled:opacity-30"
                        >
                          <ArrowUpIcon className="h-3.5 w-3.5" />
                        </button>
                        <button
                          aria-label="Move down"
                          disabled={i === rows.length - 1 || isPending}
                          onClick={() => move(i, 1)}
                          className="rounded-control p-1 text-muted transition-colors hover:bg-black/[.05] hover:text-ink disabled:opacity-30"
                        >
                          <ArrowDownIcon className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </td>
                <td className="px-3 text-ink">
                  {r.inspection?.name ?? "—"}
                  {r.inspection && !r.inspection.active && (
                    <span className="ml-1.5 text-[11px] text-muted">(inactive)</span>
                  )}
                </td>
                {canEdit && (
                  <td className="px-3 text-right">
                    <button
                      disabled={isPending}
                      onClick={() => remove(r)}
                      className={dangerLinkButtonClass}
                    >
                      Remove
                    </button>
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
