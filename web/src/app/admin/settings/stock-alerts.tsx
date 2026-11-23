"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inputClass, primaryButtonClass, secondaryButtonClass, sectionHeadingClass } from "../ui";
import { addStockAlertRecipient, removeStockAlertRecipient, type StockAlertPeople } from "./actions";

// Who gets the daily low-stock email (MWTS R6). The email lists everything
// below the minimum levels set under Stock Master Files → Minimum Levels.
export function StockAlerts({ people, emailEnabled }: { people: StockAlertPeople; emailEnabled: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [choice, setChoice] = useState("");
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ error: string | null }>) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      else {
        setChoice("");
        router.refresh();
      }
    });
  };

  return (
    <section className="rounded-card border border-border bg-card">
      <div className="border-b border-border px-5 py-4 md:px-6">
        <h2 className={sectionHeadingClass}>Low-stock email</h2>
      </div>
      <div className="flex flex-col gap-4 px-5 py-5 md:px-6">
        <p className="text-sm text-muted">
          Every morning at 06:30 the people below get one email listing every item that is below its minimum level. No
          email is sent when nothing is low.
          {!emailEnabled && <span className="font-semibold text-warning"> Email notifications are switched off above, so nothing is sent yet.</span>}
        </p>
        {people.recipients.length === 0 ? (
          <p className="text-sm text-muted">Nobody is on the list yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-control border border-border">
            {people.recipients.map((p) => (
              <li key={p.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="font-medium text-ink">{p.name}</span>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => removeStockAlertRecipient(p.id))}
                  className="text-xs font-semibold text-danger hover:underline disabled:opacity-50"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <select value={choice} onChange={(e) => setChoice(e.target.value)} className={`${inputClass} min-w-56`}>
            <option value="">Add a person…</option>
            {people.candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={pending || !choice}
            onClick={() => run(() => addStockAlertRecipient(choice))}
            className={choice ? primaryButtonClass : secondaryButtonClass}
          >
            Add
          </button>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </section>
  );
}
