"use client";

import { useEffect, useState, useTransition } from "react";
import { Modal } from "../modal";
import { PlusIcon } from "../icons";
import {
  dangerLinkButtonClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  sectionHeadingClass,
  smallPrimaryButtonClass,
  tableHeadCellClass,
} from "../ui";
import type { Account, IncidentSubscription } from "@/lib/inspection-setup/types";
import {
  createIncidentSubscription,
  deleteIncidentSubscription,
  listIncidentSubscriptions,
} from "./actions";

type Ctx =
  | { mode: "add"; saveFirst: () => Promise<string | null> }
  | { mode: "edit"; id: string };

// The "Subscriptions" group box on IncidentType_NewEdit. Subscriptions are
// written immediately (ACT_IncidentSubscription_Save commits on its own).
export function SubscriptionsSection({
  ctx,
  accounts,
  canEdit,
}: {
  ctx: Ctx;
  accounts: Account[];
  canEdit: boolean;
}) {
  const incidentTypeId = ctx.mode === "edit" ? ctx.id : null;
  const [subs, setSubs] = useState<IncidentSubscription[] | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [pick, setPick] = useState("");
  const [modalError, setModalError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!incidentTypeId) return;
    let cancelled = false;
    listIncidentSubscriptions(incidentTypeId).then((rows) => {
      if (!cancelled) setSubs(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [incidentTypeId]);

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const rows = (subs ?? [])
    .map((s) => ({ ...s, account: accountById.get(s.user_id) }))
    .sort((a, b) => (a.account?.username ?? "").localeCompare(b.account?.username ?? ""));

  // ACT_IncidentType_AddIncidentSubscription: the parent IncidentType is
  // validated and saved first, so a brand-new type is created before the
  // subscription popup opens.
  function openAdd() {
    setError(null);
    startTransition(async () => {
      if (ctx.mode === "add" && !(await ctx.saveFirst())) return;
      setPick("");
      setModalError(null);
      setModalOpen(true);
    });
  }

  function saveSubscription(typeId: string) {
    // INCSUB-R01
    if (!pick) {
      setModalError("Account is required.");
      return;
    }
    startTransition(async () => {
      const res = await createIncidentSubscription(typeId, pick);
      if (res.error) {
        setModalError(res.error);
        return;
      }
      setModalOpen(false);
      setSubs(await listIncidentSubscriptions(typeId));
    });
  }

  function remove(sub: IncidentSubscription) {
    setError(null);
    startTransition(async () => {
      const res = await deleteIncidentSubscription(sub.id);
      if (res.error) setError(res.error);
      else setSubs(await listIncidentSubscriptions(sub.incident_type_id));
    });
  }

  return (
    <section className="mt-8 overflow-hidden rounded-card border border-border">
      <div className="flex min-h-[52px] items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div>
          <h3 className={sectionHeadingClass}>Subscriptions</h3>
          {canEdit && (
            <p className="mt-0.5 text-[11px] text-muted">Changes here save immediately.</p>
          )}
        </div>
        {canEdit && (
          <button disabled={isPending} onClick={openAdd} className={smallPrimaryButtonClass}>
            <PlusIcon className="h-3.5 w-3.5" />
            Add
          </button>
        )}
      </div>

      {error && (
        <p className="mx-4 mt-3 border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">
          {error}
        </p>
      )}

      {ctx.mode === "add" ? (
        <p className="px-4 py-6 text-center text-[13px] text-muted">
          No subscribers yet. Adding one saves this incident type first.
        </p>
      ) : subs === null ? (
        <p className="px-4 py-6 text-center text-[13px] text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-[13px] text-muted">No subscribers yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-table-head">
              <th className={tableHeadCellClass}>Name</th>
              <th className={tableHeadCellClass}>Email</th>
              <th className={tableHeadCellClass}>Changed</th>
              {canEdit && <th className={tableHeadCellClass} />}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} className="h-[44px] border-t border-border">
                <td className="px-3 text-ink">{s.account?.username ?? "Unknown account"}</td>
                <td className="px-3 text-ink">{s.account?.email ?? "—"}</td>
                <td className="px-3 whitespace-nowrap text-muted">
                  {new Date(s.updated_at).toLocaleDateString()}
                </td>
                {canEdit && (
                  <td className="px-3 text-right">
                    <button
                      disabled={isPending}
                      onClick={() => remove(s)}
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

      {modalOpen && incidentTypeId && (
        <Modal
          open
          title="Add Subscriber"
          onClose={() => setModalOpen(false)}
          footer={
            <>
              <button
                disabled={isPending}
                onClick={() => setModalOpen(false)}
                className={secondaryButtonClass}
              >
                Cancel
              </button>
              <button
                disabled={isPending}
                onClick={() => saveSubscription(incidentTypeId)}
                className={primaryButtonClass}
              >
                {isPending ? "Saving…" : "Save"}
              </button>
            </>
          }
        >
          <div className="flex flex-col gap-1.5">
            <label className={labelClass}>Account</label>
            <select
              autoFocus
              className={inputClass}
              value={pick}
              onChange={(e) => setPick(e.target.value)}
            >
              <option value="">Select…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.username} — {a.email}
                </option>
              ))}
            </select>
            {modalError && <span className="text-xs text-danger">{modalError}</span>}
          </div>
        </Modal>
      )}
    </section>
  );
}
