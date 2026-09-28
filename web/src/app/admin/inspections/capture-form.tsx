"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { formatDateTime } from "@/lib/incidents/format";
import { discardUploads } from "@/lib/incidents/image-upload";
import type { FormImage, NewImage } from "@/lib/incidents/types";
import { isoToZonedInput, zonedInputToIso } from "@/lib/inspections/dates";
import type {
  CaptureContext,
  CaptureInspection,
  CaptureValue,
  SaveActivityValue,
  SaveMessage,
} from "@/lib/inspections/types";
import { CameraIcon } from "../icons";
import { Modal } from "../modal";
import { PhotoPicker } from "../incidents/photos";
import { inputClass, primaryButtonClass, secondaryButtonClass } from "../ui";
import { saveActivity } from "./actions";
import { GradingBadge } from "./badges";

const BUCKET = "inspection-images";

type FieldErrors = Record<string, Partial<Record<NonNullable<SaveMessage["field"]>, string>>>;

// Inspection_NewEdit — the capture page, for a new activity (ad hoc or from
// an instruction) and for editing one of the inspector's own from today.
// Everything stays in memory until Save; save_inspection_activity validates
// it (validation §3) and either saves it all or returns the messages and any
// Feedback retries, which are applied here (C4: the attempt becomes
// read-only and a fresh row appears after it).
export function CaptureForm({
  context,
  timeZone,
  openedAt,
}: {
  context: CaptureContext;
  timeZone: string;
  // When the page was opened: the new activity's displayed date (IAC-R01).
  openedAt: string;
}) {
  const router = useRouter();
  const inspections = new Map(context.inspections.map((i) => [i.id, i]));
  const [values, setValues] = useState<CaptureValue[]>(context.values);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [popups, setPopups] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [photosFor, setPhotosFor] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const backHref = context.instruction
    ? `/admin/inspections/instructions/${context.instruction.legacy_uid}`
    : "/admin/inspections?tab=today";
  const uploading = values.some((v) => v.images.some((i) => i.uploading));

  function update(id: string, patch: Partial<CaptureValue>) {
    setValues((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  }

  function newUploads(list: CaptureValue[]): NewImage[] {
    return list.flatMap((v) => v.images.filter((i) => !i.id && i.upload).map((i) => i.upload!));
  }

  function save() {
    setError(null);
    // The number box's own check: the reading must be a number. A cleared
    // required box is "Required", as a cleared Mendix decimal would be.
    const clientErrors: FieldErrors = {};
    for (const v of values) {
      const insp = inspections.get(v.inspection_id)!;
      if (insp.value_type !== "DECIMAL_VALUE" && insp.value_type !== "CUMULATIVE_VALUE") continue;
      if (v.decimal_value.trim() === "") {
        if (insp.is_required) clientErrors[v.id] = { decimal_value: "Required" };
      } else if (!Number.isFinite(Number(v.decimal_value))) {
        clientErrors[v.id] = { decimal_value: "Enter a number." };
      }
    }
    setFieldErrors(clientErrors);
    if (Object.keys(clientErrors).length > 0) return;

    const payload: SaveActivityValue[] = values.map((v) => ({
      id: v.id,
      inspection_id: v.inspection_id,
      is_current: v.is_current,
      text_value: v.text_value,
      decimal_value: v.decimal_value.trim() === "" ? 0 : Number(v.decimal_value),
      date_value: v.date_value || null,
      drop_down_option_id: v.drop_down_option_id || null,
      images: v.images
        .filter((i) => !i.error && (i.id || i.upload))
        .map((i) => (i.id ? { id: i.id } : { ...i.upload! })),
    }));

    startTransition(async () => {
      const res = await saveActivity({
        id: context.activity?.id ?? null,
        asset_id: context.asset.id,
        instruction_id: context.instruction?.id ?? null,
        values: payload,
      });
      if (res.ok) {
        router.push(backHref);
        router.refresh();
        return;
      }
      if ("error" in res) {
        setError(res.error);
        return;
      }

      const errors: FieldErrors = {};
      for (const m of res.messages) {
        if (m.kind === "field" && m.field) errors[m.value_id] = { ...errors[m.value_id], [m.field]: m.message };
      }
      setFieldErrors(errors);
      setPopups(res.messages.filter((m) => m.kind === "popup").map((m) => m.message));

      if (res.retries.length > 0) {
        setValues((prev) => {
          let next = [...prev];
          for (const r of res.retries) {
            next = next.flatMap((v) =>
              v.id === r.superseded_id
                ? [
                    { ...v, is_current: false },
                    {
                      id: r.new_id,
                      inspection_id: r.inspection_id,
                      is_current: true,
                      text_value: "",
                      decimal_value: "0",
                      date_value: "",
                      drop_down_option_id: "",
                      images: [],
                    },
                  ]
                : [v],
            );
          }
          return next;
        });
      }
    });
  }

  function cancel() {
    if (!confirm("Are you sure?")) return;
    void discardUploads(newUploads(values), BUCKET);
    router.push(backHref);
  }

  const photoValue = values.find((v) => v.id === photosFor) ?? null;

  return (
    <div className="px-4 pb-28 md:px-8 md:pb-10">
      <div className="mx-auto flex max-w-2xl flex-col gap-3">
        <section className="rounded-card border border-border bg-card px-5 py-4">
          <div className="text-[13px] font-medium text-primary">📍 {context.asset.location.name}</div>
          <dl className="mt-2 grid grid-cols-[130px_1fr] gap-y-1 text-sm">
            <dt className="text-muted">Asset</dt>
            <dd className="font-semibold text-ink">
              {context.asset.name} <span className="font-mono text-xs font-normal text-muted">{context.asset.code}</span>
            </dd>
            <dt className="text-muted">Inspection date</dt>
            <dd className="text-ink">{formatDateTime(context.activity?.inspection_date ?? openedAt, timeZone)}</dd>
            {context.instruction && (
              <>
                <dt className="text-muted">Instruction</dt>
                <dd className="text-ink">{context.instruction.name}</dd>
              </>
            )}
          </dl>
        </section>

        {error && <p className="border-l-2 border-danger bg-card py-2 pl-3 text-[13px] text-danger">{error}</p>}

        {values.length === 0 && (
          <p className="rounded-card border border-border bg-card px-4 py-8 text-center text-sm text-muted">
            No inspections are allocated to {context.asset.asset_type.name}. You can still save this inspection.
          </p>
        )}

        {values.map((v) => (
          <ValueCard
            key={v.id}
            value={v}
            inspection={inspections.get(v.inspection_id)!}
            errors={fieldErrors[v.id] ?? {}}
            timeZone={timeZone}
            disabled={isPending}
            onChange={(patch) => update(v.id, patch)}
            onPhotos={() => setPhotosFor(v.id)}
          />
        ))}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card px-4 py-3 md:static md:mx-auto md:mt-4 md:max-w-2xl md:border-0 md:bg-transparent md:p-0">
        <div className="mx-auto flex max-w-2xl justify-end gap-2">
          <button type="button" className={secondaryButtonClass} disabled={isPending} onClick={cancel}>
            Cancel
          </button>
          <button type="button" className={`${primaryButtonClass} min-w-[96px]`} disabled={isPending || uploading} onClick={save}>
            {isPending ? "Saving…" : uploading ? "Uploading…" : "Save"}
          </button>
        </div>
      </div>

      {photoValue && (
        <Modal
          open
          title={`${inspections.get(photoValue.inspection_id)!.name} — photos`}
          onClose={() => setPhotosFor(null)}
          footer={
            <button type="button" className={primaryButtonClass} onClick={() => setPhotosFor(null)}>
              Save &amp; Close
            </button>
          }
        >
          <PhotoPicker
            bucket={BUCKET}
            images={photoValue.images}
            onChange={(fn) =>
              setValues((prev) => prev.map((v) => (v.id === photoValue.id ? { ...v, images: fn(v.images) } : v)))
            }
          />
          {photoValue.images.length === 0 && <p className="mt-3 text-[13px] text-muted">No Images Taken</p>}
        </Modal>
      )}

      {popups.length > 0 && (
        <Modal
          open
          title="Please check"
          onClose={() => setPopups([])}
          footer={
            <button type="button" className={primaryButtonClass} onClick={() => setPopups([])}>
              OK
            </button>
          }
        >
          <ul className="flex flex-col gap-3">
            {popups.map((p, i) => (
              <li key={i} className="border-l-2 border-warning py-1 pl-3 text-sm whitespace-pre-line text-ink">
                {p}
              </li>
            ))}
          </ul>
        </Modal>
      )}
    </div>
  );
}

function ValueCard({
  value,
  inspection,
  errors,
  timeZone,
  disabled,
  onChange,
  onPhotos,
}: {
  value: CaptureValue;
  inspection: CaptureInspection;
  errors: FieldErrors[string];
  timeZone: string;
  disabled: boolean;
  onChange: (patch: Partial<CaptureValue>) => void;
  onPhotos: () => void;
}) {
  const [showInfo, setShowInfo] = useState(false);
  const photoCount = value.images.filter((i: FormImage) => !i.error).length;
  const superseded = !value.is_current;
  const inputId = `value-${value.id}`;
  // Inspection_SelectDropDownOption lists [Active] options by priority; a
  // saved option that was deactivated since is still shown.
  const options = inspection.options.filter((o) => o.active || o.id === value.drop_down_option_id);
  const chosen = inspection.options.find((o) => o.id === value.drop_down_option_id);

  return (
    <section
      className={`rounded-card border bg-card px-5 py-4 ${superseded ? "border-dashed border-border opacity-80" : "border-border"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <label htmlFor={inputId} className="text-sm font-semibold text-ink">
          {inspection.name}
          {inspection.is_required && <span className="ml-0.5 text-danger"> *</span>}
        </label>
        <button
          type="button"
          onClick={() => setShowInfo((s) => !s)}
          aria-label={`About ${inspection.name}`}
          aria-expanded={showInfo}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-xs font-semibold text-muted hover:text-ink"
        >
          i
        </button>
      </div>
      {showInfo && <p className="mt-1 text-[13px] text-muted">{inspection.description || "NA"}</p>}
      {superseded && (
        <p className="mt-1 text-xs font-medium text-warning">Earlier attempt — kept for the record, can&apos;t be changed.</p>
      )}

      <div className="mt-3">
        {inspection.value_type === "TEXT" && (
          <input
            id={inputId}
            className={inputClass}
            value={value.text_value}
            disabled={disabled}
            onChange={(e) => onChange({ text_value: e.target.value })}
          />
        )}
        {(inspection.value_type === "DECIMAL_VALUE" || inspection.value_type === "CUMULATIVE_VALUE") && (
          <input
            id={inputId}
            type="text"
            inputMode="decimal"
            className={inputClass}
            value={value.decimal_value}
            readOnly={superseded}
            disabled={disabled || superseded}
            onFocus={(e) => e.target.select()}
            onChange={(e) => onChange({ decimal_value: e.target.value.replace(",", ".") })}
          />
        )}
        {inspection.value_type === "DATETIME" && (
          <input
            id={inputId}
            type="datetime-local"
            className={inputClass}
            value={isoToZonedInput(value.date_value, timeZone)}
            disabled={disabled}
            onChange={(e) => onChange({ date_value: zonedInputToIso(e.target.value, timeZone) })}
          />
        )}
        {inspection.value_type === "DROP_DOWN" && (
          <div className="flex items-center gap-2">
            <select
              id={inputId}
              className={inputClass}
              value={value.drop_down_option_id}
              disabled={disabled}
              onChange={(e) => onChange({ drop_down_option_id: e.target.value })}
            >
              <option value="">Select…</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            {chosen && <GradingBadge grading={chosen.grading} />}
          </div>
        )}
        {Object.values(errors).map((message, i) => (
          <p key={i} className="mt-1 text-xs text-danger">
            {message}
          </p>
        ))}
      </div>

      <button
        type="button"
        onClick={onPhotos}
        disabled={disabled}
        className={`mt-3 flex h-[34px] items-center gap-1.5 rounded-control border px-3 text-[13px] font-semibold transition-colors disabled:opacity-60 ${
          photoCount < inspection.nr_of_images_required
            ? "border-warning/40 bg-warning-bg text-warning"
            : "border-border bg-white text-ink hover:bg-black/[.03]"
        }`}
      >
        <CameraIcon className="h-4 w-4" />
        {photoCount} / {inspection.nr_of_images_required}
      </button>
    </section>
  );
}
