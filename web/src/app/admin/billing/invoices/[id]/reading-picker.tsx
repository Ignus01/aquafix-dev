"use client";

import { useEffect, useState, useTransition } from "react";
import { formatDay } from "@/lib/dashboard/format";
import { formatDateTime } from "@/lib/incidents/format";
import { formatQty } from "@/lib/billing/format";
import { METER_UNIT, type InvoiceLineView, type NearbyReading, type ReadingSide } from "@/lib/billing/types";
import { CameraIcon } from "../../../icons";
import { Modal } from "../../../modal";
import { inputClass, labelClass, linkButtonClass, primaryButtonClass, secondaryButtonClass } from "../../../ui";
import { listLineReadings, setReading } from "../../actions";

type Reading = NearbyReading & { image_url: string | null };

// Pick another meter reading near the billing date, type a value (with a
// reason), or go back to the automatic choice.
export function ReadingPicker({
  line,
  side,
  target,
  timeZone,
  onClose,
  onSaved,
}: {
  line: InvoiceLineView;
  side: ReadingSide;
  target: string;
  timeZone: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [readings, setReadings] = useState<Reading[] | null>(null);
  const [manual, setManual] = useState("");
  const [note, setNote] = useState(line.note);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const currentId = side === "prev" ? line.prev_value_id : line.curr_value_id;

  useEffect(() => {
    let alive = true;
    listLineReadings(line.id, side).then((result) => {
      if (!alive) return;
      if (result.error) setError(result.error);
      setReadings(result.readings);
    });
    return () => {
      alive = false;
    };
  }, [line.id, side]);

  function save(choice: Parameters<typeof setReading>[2]) {
    setError(null);
    startTransition(async () => {
      const result = await setReading(line.id, side, choice);
      if (result.error) setError(result.error);
      else onSaved();
    });
  }

  const unit = METER_UNIT[line.meter];

  return (
    <Modal
      open
      title={`${side === "prev" ? "Opening" : "Closing"} reading — ${line.asset_name}`}
      onClose={onClose}
      width={720}
    >
      <div className="flex max-h-[75vh] flex-col gap-4 overflow-y-auto px-6 py-5">
        <p className="text-[13px] text-muted">
          Readings of this meter closest to the billing date, {formatDay(target)}.
        </p>
        {error && <p className="text-sm text-danger">{error}</p>}
        {readings === null ? (
          <p className="text-sm text-muted">Loading readings…</p>
        ) : readings.length === 0 ? (
          <p className="text-sm text-muted">This meter has no readings.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {readings.map((r) => {
              const isCurrent = r.value_id === currentId;
              return (
                <button
                  key={r.value_id}
                  type="button"
                  disabled={pending || isCurrent}
                  onClick={() => save({ valueId: r.value_id, note: note || null })}
                  className={`flex gap-3 rounded-control border p-2 text-left transition-colors ${
                    isCurrent ? "border-primary bg-primary/5" : "border-border hover:bg-row-hover"
                  }`}
                >
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-control bg-table-head">
                    {r.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.image_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <CameraIcon className="h-5 w-5 text-muted" />
                    )}
                  </div>
                  <div className="flex flex-col">
                    <span className="font-semibold text-ink tabular-nums">
                      {formatQty(r.value)} {unit}
                    </span>
                    <span className="text-xs text-muted">{formatDateTime(r.read_at, timeZone)}</span>
                    <span className={`text-xs ${Math.abs(r.day_diff) <= 1 ? "text-success" : "text-warning"}`}>
                      {r.day_diff === 0
                        ? "On the billing date"
                        : `${Math.abs(r.day_diff)} day${Math.abs(r.day_diff) === 1 ? "" : "s"} ${r.day_diff < 0 ? "before" : "after"}`}
                      {isCurrent && " · in use"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex flex-col gap-3 rounded-control border border-border p-4">
          <div className="text-sm font-semibold text-ink">Type a reading</div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex w-40 flex-col gap-1.5">
              <span className={labelClass}>Value ({unit})</span>
              <input type="number" step="any" value={manual} onChange={(e) => setManual(e.target.value)} className={inputClass} />
            </label>
            <label className="flex min-w-[240px] flex-1 flex-col gap-1.5">
              <span className={labelClass}>Reason / note</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} className={inputClass} />
            </label>
            <button
              type="button"
              disabled={pending || manual === "" || !note.trim()}
              onClick={() => save({ manualValue: Number(manual), note })}
              className={primaryButtonClass}
            >
              Use value
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <button type="button" disabled={pending} onClick={() => save({ note: note || null })} className={linkButtonClass}>
            Reset to the automatic reading
          </button>
          <button type="button" onClick={onClose} className={secondaryButtonClass}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
