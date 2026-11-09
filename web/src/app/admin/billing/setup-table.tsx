"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { formatDay } from "@/lib/dashboard/format";
import { formatRate } from "@/lib/billing/format";
import { BILLING_METER_OPTIONS, billingMeterLabel, type SetupLocation } from "@/lib/billing/types";
import { assetClassificationLabel } from "@/lib/masterdata/types";
import { SearchInput } from "../data-grid";
import { Modal } from "../modal";
import { cellInputClass, dangerLinkButtonClass, inputClass, labelClass, linkButtonClass, smallPrimaryButtonClass } from "../ui";
import { addTariff, deleteTariff, setBillingDay } from "./actions";

const th = "px-4 py-2.5 text-left text-[11px] font-semibold text-muted whitespace-nowrap";
const DAYS = Array.from({ length: 30 }, (_, i) => i + 1);

// The tariff in effect on `day`: the latest one starting on or before it.
const currentTariff = (l: SetupLocation, day: string) => l.tariffs.find((t) => t.effective_from <= day) ?? null;

export function SetupTable({ locations, today }: { locations: SetupLocation[]; today: string }) {
  const [query, setQuery] = useState("");
  const [onlyBilled, setOnlyBilled] = useState(false);
  const [tariffFor, setTariffFor] = useState<string | null>(null);
  const [metersFor, setMetersFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return locations.filter(
      (l) =>
        (!onlyBilled || l.billing_day !== null) &&
        (!q || [l.name, l.organisation, l.region].some((v) => v?.toLowerCase().includes(q))),
    );
  }, [locations, query, onlyBilled]);

  function run(action: () => Promise<{ error: string | null }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
    });
  }

  const tariffLocation = locations.find((l) => l.id === tariffFor) ?? null;
  const metersLocation = locations.find((l) => l.id === metersFor) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4">
        <SearchInput value={query} onChange={setQuery} placeholder="Search locations…" />
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={onlyBilled} onChange={(e) => setOnlyBilled(e.target.checked)} />
          Only billed locations
        </label>
        {pending && <span className="text-xs text-muted">Saving…</span>}
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="overflow-hidden rounded-card border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-table-head">
                <th className={th}>Location</th>
                <th className={th}>Organisation</th>
                <th className={th}>Billing day (readings)</th>
                <th className={th}>Tariff per kL</th>
                <th className={th}>Billing meters</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted">
                    No locations match.
                  </td>
                </tr>
              )}
              {rows.map((l) => {
                const tariff = currentTariff(l, today);
                const billed = l.meters.filter((m) => m.billing_meter !== null);
                const hasTreated = billed.some((m) => m.billing_meter === "treated");
                return (
                  <tr key={l.id} className="h-[54px] border-t border-border">
                    <td className="px-4 font-semibold text-ink">{l.name}</td>
                    <td className="px-4 text-muted">{l.organisation ?? "—"}</td>
                    <td className="w-56 px-4">
                      <select
                        aria-label={`Billing day for ${l.name}`}
                        value={l.billing_day ?? ""}
                        onChange={(e) =>
                          run(() => setBillingDay(l.id, e.target.value === "" ? null : Number(e.target.value)))
                        }
                        className={cellInputClass}
                      >
                        <option value="">Not billed</option>
                        {DAYS.map((d) => (
                          <option key={d} value={d}>
                            Day {d}
                          </option>
                        ))}
                        <option value={31}>Last day of month</option>
                      </select>
                    </td>
                    <td className="px-4 whitespace-nowrap">
                      <button type="button" onClick={() => setTariffFor(l.id)} className="text-left">
                        {tariff ? (
                          <span className="font-semibold text-ink tabular-nums">{formatRate(tariff.rate)}</span>
                        ) : (
                          <span className={l.billing_day !== null ? "font-semibold text-warning" : "text-muted"}>
                            No tariff
                          </span>
                        )}
                        <span className={`ml-2 ${linkButtonClass}`}>Edit</span>
                      </button>
                    </td>
                    <td className="px-4">
                      <button type="button" onClick={() => setMetersFor(l.id)} className="flex flex-wrap items-center gap-1.5 text-left">
                        {BILLING_METER_OPTIONS.map((o) => {
                          const n = billed.filter((m) => m.billing_meter === o.value).length;
                          if (n === 0) return null;
                          return (
                            <span key={o.value} className="rounded-full bg-black/[.04] px-2 py-0.5 text-xs text-ink">
                              {o.label}
                              {n > 1 ? ` ×${n}` : ""}
                            </span>
                          );
                        })}
                        {l.billing_day !== null && !hasTreated && (
                          <span className="rounded-full bg-warning-bg px-2 py-0.5 text-xs font-semibold text-warning">
                            No treated meter
                          </span>
                        )}
                        {billed.length === 0 && l.billing_day === null && <span className="text-muted">—</span>}
                        <span className={linkButtonClass}>View</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {tariffLocation && (
        <TariffModal location={tariffLocation} today={today} onClose={() => setTariffFor(null)} />
      )}
      {metersLocation && <MetersModal location={metersLocation} onClose={() => setMetersFor(null)} />}
    </div>
  );
}

function TariffModal({ location, today, onClose }: { location: SetupLocation; today: string; onClose: () => void }) {
  const [rate, setRate] = useState("");
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const current = currentTariff(location, today);

  function run(action: () => Promise<{ error: string | null }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) setError(result.error);
      else after?.();
    });
  }

  return (
    <Modal open title={`Tariff — ${location.name}`} onClose={onClose} width={520}>
      <div className="flex flex-col gap-5 px-6 py-5">
        <p className="text-[13px] text-muted">
          Rate in rand per kL of treated water. An invoice uses the rate in effect on its billing date, so add a new
          rate from the date it applies instead of changing the old one.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex w-36 flex-col gap-1.5">
            <span className={labelClass}>Rate (R/kL)</span>
            <input
              type="number"
              min="0"
              step="0.0001"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className={inputClass}
            />
          </label>
          <label className="flex w-44 flex-col gap-1.5">
            <span className={labelClass}>Applies from</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
          </label>
          <button
            type="button"
            disabled={pending || !rate || !from}
            onClick={() => run(() => addTariff(location.id, Number(rate), from), () => setRate(""))}
            className={`${smallPrimaryButtonClass} h-[42px]`}
          >
            Add rate
          </button>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="overflow-hidden rounded-control border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-table-head">
                <th className={th}>Applies from</th>
                <th className={th}>Rate</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody>
              {location.tariffs.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-5 text-center text-muted">
                    No tariff yet.
                  </td>
                </tr>
              )}
              {location.tariffs.map((t) => (
                <tr key={t.id} className="h-[44px] border-t border-border">
                  <td className="px-4 text-ink">
                    {formatDay(t.effective_from)}
                    {current?.id === t.id && (
                      <span className="ml-2 rounded-full bg-success-bg px-2 py-0.5 text-xs font-semibold text-success">
                        Current
                      </span>
                    )}
                  </td>
                  <td className="px-4 font-semibold text-ink tabular-nums">{formatRate(t.rate)}</td>
                  <td className="px-4 text-right">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(() => deleteTariff(t.id))}
                      className={dangerLinkButtonClass}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

// Read-only: what a meter is billed as follows its asset type's
// classification, which is set under Master Data.
function MetersModal({ location, onClose }: { location: SetupLocation; onClose: () => void }) {
  return (
    <Modal open title={`Billing meters — ${location.name}`} onClose={onClose} width={640}>
      <div className="flex flex-col gap-4 px-6 py-5">
        <p className="text-[13px] text-muted">
          Each meter&apos;s &quot;Meter Reading&quot; inspection is read on the billing date. Meters go on the invoice by
          their asset type: treated meters are invoiced; borehole and electrical meters are shown for information;
          municipal meters are left off. To change what a meter is billed as, change its asset type (Assets tab) or
          the type&apos;s classification (Asset Types tab) in{" "}
          <Link href="/admin/masterdata?tab=asset_type" className={linkButtonClass}>
            Master Data
          </Link>
          .
        </p>
        <div className="overflow-hidden rounded-control border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-table-head">
                <th className={th}>Asset</th>
                <th className={th}>Asset type</th>
                <th className={th}>Billed as</th>
              </tr>
            </thead>
            <tbody>
              {location.meters.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-5 text-center text-muted">
                    This location has no meter assets.
                  </td>
                </tr>
              )}
              {location.meters.map((m) => (
                <tr key={m.id} className="h-[48px] border-t border-border">
                  <td className="px-4 text-ink">
                    <div className="font-semibold">{m.name}</div>
                    <div className="font-mono text-xs text-muted">{m.code}</div>
                  </td>
                  <td className="px-4">
                    <div className="text-ink">{m.asset_type}</div>
                    <div className="text-xs text-muted">{assetClassificationLabel(m.classification)}</div>
                  </td>
                  <td className="w-40 px-4">
                    {m.billing_meter ? (
                      <span className="rounded-full bg-black/[.04] px-2 py-0.5 text-xs text-ink">
                        {billingMeterLabel(m.billing_meter)}
                      </span>
                    ) : (
                      <span className="text-muted">Not billed</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
