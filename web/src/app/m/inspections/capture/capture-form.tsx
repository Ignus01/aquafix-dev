"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
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
import { saveActivity } from "../../../admin/inspections/actions";
import { PhotoPicker } from "../../../admin/incidents/photos";
import { ConfirmDialog, Sheet } from "../../components";
import { shortDateTime } from "../../format";
import { CameraIcon, InfoIcon, PinIcon } from "../../icons";
import { ErrorLine, FormFooter, mBtnGreen, mBtnLight, mInput } from "../../ui";

const BUCKET = "inspection-images";

type FieldErrors = Record<string, Partial<Record<NonNullable<SaveMessage["field"]>, string>>>;

// Inspection_NewEdit for the phone. Everything stays in memory until Save;
// save_inspection_activity validates it and either saves it all or returns
// messages and Feedback retries (same flow as the desktop capture form).
export function CaptureForm({
  context,
  timeZone,
  openedAt,
}: {
  context: CaptureContext;
  timeZone: string;
  openedAt: string;
}) {
  const router = useRouter();
  const inspections = new Map(context.inspections.map((i) => [i.id, i]));
  const [values, setValues] = useState<CaptureValue[]>(context.values);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [popups, setPopups] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [photosFor, setPhotosFor] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [isPending, startTransition] = useTransition();

  const backHref = context.instruction ? `/m/instructions/${context.instruction.legacy_uid}` : "/m/inspections";
  const uploading = values.some((v) => v.images.some((i) => i.uploading));

  function update(id: string, patch: Partial<CaptureValue>) {
    setValues((prev) => prev.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  }

  function newUploads(list: CaptureValue[]): NewImage[] {
    return list.flatMap((v) => v.images.filter((i) => !i.id && i.upload).map((i) => i.upload!));
  }

  function save() {
    setError(null);
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
    void discardUploads(newUploads(values), BUCKET);
    router.push(backHref);
  }

  const photoValue = values.find((v) => v.id === photosFor) ?? null;

  return (
    <div className="flex-1 pb-[88px]">
      <div className="flex items-center gap-3 px-4 pt-3 text-[20px] font-semibold text-[#5b6480] uppercase">
        <PinIcon className="h-5 w-5 text-[#0b1426]" />
        {context.asset.location.name}
      </div>

      <div className="grid grid-cols-[1fr_1fr] gap-4 px-4 pt-2">
        <div>
          <label className="mb-1.5 block text-[19px] font-semibold">Asset</label>
          <div className="rounded-[8px] border border-[#dfe2e8] bg-[#f0f1f4] px-3.5 py-3.5 text-[19px]">{context.asset.name}</div>
        </div>
        <div>
          <label className="mb-1.5 block text-[19px] font-semibold">Inspection Date</label>
          <div className="rounded-[8px] border border-[#dfe2e8] bg-[#f0f1f4] px-3 py-2 text-center text-[18px] leading-tight">
            {shortDateTime(context.activity?.inspection_date ?? openedAt, timeZone)}
          </div>
        </div>
      </div>
      {context.instruction && (
        <p className="px-4 pt-3 text-[16px] text-[#5b6480]">Instruction: {context.instruction.name}</p>
      )}

      {error && <p className="mx-4 mt-3 rounded-[8px] bg-[#fdedec] px-3 py-2 text-[16px] text-[#b42318]">{error}</p>}

      <div className="mt-4 bg-white">
        {values.length === 0 && (
          <p className="border-y border-[#3b4150] px-4 py-6 text-[17px] text-[#5b6480]">
            No inspections are allocated to {context.asset.asset_type.name}. You can still save this inspection.
          </p>
        )}
        {values.map((v) => (
          <ValueRow
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

      <FormFooter>
        <button type="button" className={mBtnLight} disabled={isPending} onClick={() => setConfirmCancel(true)}>
          Cancel
        </button>
        <button type="button" className={mBtnGreen} disabled={isPending || uploading} onClick={save}>
          {isPending ? "Saving…" : uploading ? "Uploading…" : "Save"}
        </button>
      </FormFooter>

      <ConfirmDialog open={confirmCancel} onProceed={cancel} onCancel={() => setConfirmCancel(false)} />

      {photoValue && (
        <Sheet
          title={inspections.get(photoValue.inspection_id)!.name}
          onClose={() => setPhotosFor(null)}
          footer={
            <button type="button" className={`${mBtnGreen} w-full`} onClick={() => setPhotosFor(null)}>
              Save &amp; Close
            </button>
          }
        >
          <div className="p-4">
            <PhotoPicker
              bucket={BUCKET}
              images={photoValue.images}
              onChange={(fn) =>
                setValues((prev) => prev.map((v) => (v.id === photoValue.id ? { ...v, images: fn(v.images) } : v)))
              }
            />
            {photoValue.images.length === 0 && <p className="mt-3 text-[16px] text-[#5b6480]">No Images Taken</p>}
          </div>
        </Sheet>
      )}

      {popups.length > 0 && (
        <Sheet
          title="Please check"
          onClose={() => setPopups([])}
          footer={
            <button type="button" className={`${mBtnGreen} w-full`} onClick={() => setPopups([])}>
              OK
            </button>
          }
        >
          <ul className="flex flex-col gap-3 p-4">
            {popups.map((p, i) => (
              <li key={i} className="border-l-4 border-[#d97706] bg-white py-2 pl-3 text-[18px] whitespace-pre-line">
                {p}
              </li>
            ))}
          </ul>
        </Sheet>
      )}
    </div>
  );
}

function ValueRow({
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
  const options = inspection.options.filter((o) => o.active || o.id === value.drop_down_option_id);
  const chosen = inspection.options.find((o) => o.id === value.drop_down_option_id);
  const needsPhotos = photoCount < inspection.nr_of_images_required;

  return (
    <section className={`border-y border-[#3b4150] px-4 py-3 ${superseded ? "bg-[#f4f4f6] opacity-80" : ""}`} style={{ marginTop: -1 }}>
      <div className="grid grid-cols-[1fr_auto] items-end gap-3">
        <div>
          <div className="flex items-start justify-between gap-2">
            <label htmlFor={inputId} className="text-[20px] leading-snug">
              {inspection.name}
              {inspection.is_required && " *"}
            </label>
            <button
              type="button"
              onClick={() => setShowInfo((s) => !s)}
              aria-label={`About ${inspection.name}`}
              aria-expanded={showInfo}
              className="shrink-0"
            >
              <InfoIcon className="h-6 w-6 text-black" />
            </button>
          </div>
          {showInfo && <p className="mt-1 text-[16px] text-[#5b6480]">{inspection.description || "NA"}</p>}
          {superseded && <p className="mt-1 text-[14px] font-medium text-[#a4570a]">Earlier attempt — kept for the record.</p>}

          <div className="mt-2">
            {inspection.value_type === "TEXT" && (
              <input
                id={inputId}
                className={mInput}
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
                className={mInput}
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
                className={mInput}
                value={isoToZonedInput(value.date_value, timeZone)}
                disabled={disabled}
                onChange={(e) => onChange({ date_value: zonedInputToIso(e.target.value, timeZone) })}
              />
            )}
            {inspection.value_type === "DROP_DOWN" && (
              <div className="flex items-center gap-2">
                <select
                  id={inputId}
                  className={`${mInput} bg-[#f0f1f4]`}
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
                {chosen?.grading && (
                  <span
                    className="shrink-0 rounded-[6px] px-2 py-1 text-[13px] font-semibold text-white"
                    style={{ background: chosen.grading.hex_colour ?? "#6b7280" }}
                  >
                    {chosen.grading.name}
                  </span>
                )}
              </div>
            )}
            {Object.values(errors).map((message, i) => (
              <ErrorLine key={i}>{message}</ErrorLine>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-4 pb-1">
          <button
            type="button"
            onClick={onPhotos}
            disabled={disabled}
            aria-label="Photos"
            className={`flex h-[72px] w-[84px] items-center justify-center rounded-[6px] text-white disabled:opacity-60 ${
              needsPhotos ? "bg-[#0b86d8]" : "bg-[#3bb54a]"
            }`}
          >
            <CameraIcon className="h-8 w-8" />
          </button>
          <span className="w-[44px] text-[22px] whitespace-nowrap">
            {photoCount} / {inspection.nr_of_images_required}
          </span>
        </div>
      </div>
    </section>
  );
}
