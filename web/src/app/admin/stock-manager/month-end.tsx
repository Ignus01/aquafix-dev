"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/incidents/format";
import { inputClass, secondaryButtonClass } from "../ui";
import { closeStockMonth, reopenStockMonth, type StockPeriod } from "./actions";
import { formatMonth } from "./reports";

const monthName = (day: string) => {
  const [y, m] = day.split("-").map(Number);
  return `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m - 1]} ${y}`;
};

// First day of the month after the one `day` is in.
function nextMonth(day: string): string {
  const [y, m] = day.split("-").map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

// The months a first close can pick: the last 12 that have ended.
function endedMonths(today: string): string[] {
  const [y, m] = today.split("-").map(Number);
  const out: string[] = [];
  for (let i = 1; i <= 12; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// Month-end lock: stock dated in a closed month can't be added, changed or
// deleted. Admins close months in order and can reopen the last one.
export function MonthEnd({
  period,
  canManage,
  today,
  timeZone,
}: {
  period: StockPeriod;
  canManage: boolean;
  today: string;
  timeZone: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const firstChoices = endedMonths(today);
  const [firstMonth, setFirstMonth] = useState(firstChoices[0]);

  const through = period.closed_through;
  const toClose = through ? nextMonth(through) : firstMonth;
  const toCloseEnded = nextMonth(toClose) <= today;
  const lastClosed = through ? `${through.slice(0, 7)}-01` : null;

  const run = (fn: () => Promise<{ error: string | null }>, confirmText: string) => {
    if (!window.confirm(confirmText)) return;
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      else router.refresh();
    });
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="rounded-card border border-border bg-card p-5">
        <p className="text-xs font-semibold tracking-wide text-muted uppercase">Stock is closed up to</p>
        <p className="mt-1 text-xl font-semibold text-ink">{through ? `the end of ${monthName(through)}` : "Nothing closed yet"}</p>
        <p className="mt-2 text-sm text-muted">
          Stock movements dated in a closed month can&apos;t be added, changed or deleted, so that month&apos;s on-hand,
          usage and cost figures stay as reported. Open months can be edited as normal.
        </p>

        {canManage ? (
          <div className="mt-5 flex flex-wrap items-end gap-3">
            {!through && (
              <label className="flex flex-col gap-1 text-xs font-medium text-muted">
                Close up to the end of
                <select value={firstMonth} onChange={(e) => setFirstMonth(e.target.value)} className={`${inputClass} min-w-48`}>
                  {firstChoices.map((m) => (
                    <option key={m} value={m}>
                      {monthName(m)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              disabled={pending || !toCloseEnded}
              title={toCloseEnded ? undefined : `${monthName(toClose)} hasn't ended yet.`}
              onClick={() =>
                run(
                  () => closeStockMonth(toClose),
                  `Close ${monthName(toClose)}? Stock dated in it${through ? "" : " or earlier"} can't be changed until an admin reopens it.`,
                )
              }
              className="flex h-[38px] items-center rounded-control bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-50"
            >
              Close {monthName(toClose)}
            </button>
            {lastClosed && (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(reopenStockMonth, `Reopen ${monthName(lastClosed)}? Its stock can be changed again until it is closed.`)
                }
                className={secondaryButtonClass}
              >
                Reopen {monthName(lastClosed)}
              </button>
            )}
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted">Only admins can close or reopen a month.</p>
        )}
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      </div>

      {period.log.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold text-ink">History</h2>
          <ul className="space-y-1 text-sm text-muted">
            {period.log.map((l, i) => (
              <li key={i}>
                <span className="font-semibold text-ink">{l.action === "close" ? "Closed" : "Reopened"} {formatMonth(l.month)}</span>{" "}
                · {l.by} · {formatDateTime(l.created_at, timeZone)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
