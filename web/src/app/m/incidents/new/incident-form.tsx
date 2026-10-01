"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { discardUploads } from "@/lib/incidents/image-upload";
import type { FieldErrors, FormImage, IncidentTypeOption, LocationOption } from "@/lib/incidents/types";
import { saveIncident } from "../../../admin/incidents/actions";
import { PhotoPicker } from "../../../admin/incidents/photos";
import { ConfirmDialog, Sheet } from "../../components";
import { CameraIcon } from "../../icons";
import { ErrorLine, FormFooter, mBtnGreen, mBtnLight, mInput, mLabel } from "../../ui";

// Incident_NewEdit for the phone.
export function IncidentForm({ types, locations }: { types: IncidentTypeOption[]; locations: LocationOption[] }) {
  const router = useRouter();
  const [typeId, setTypeId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [comment, setComment] = useState("");
  const [images, setImages] = useState<FormImage[]>([]);
  const [showPhotos, setShowPhotos] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const selectedType = types.find((t) => t.id === typeId);
  const uploading = images.some((i) => i.uploading);
  const usable = images.filter((i) => !i.error && (i.id || i.upload));

  function save() {
    setError(null);
    const errors: FieldErrors = {};
    if (!typeId) errors.incident_type_id = "Required";
    if (!locationId) errors.location_id = "Required";
    if (!comment.trim()) errors.comment = "Required";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    if (selectedType?.is_image_required && usable.length === 0) {
      setError("Please add images.");
      return;
    }

    startTransition(async () => {
      const res = await saveIncident({
        id: null,
        incident_type_id: typeId,
        location_id: locationId,
        comment,
        images: usable.map((i) => ({ id: null, ...i.upload! })),
      });
      if (res.fieldErrors) setFieldErrors(res.fieldErrors);
      if (res.error) setError(res.error);
      if (res.reference !== undefined) {
        router.push("/m/incidents");
        router.refresh();
      }
    });
  }

  function cancel() {
    void discardUploads(images.filter((i) => i.upload).map((i) => i.upload!));
    router.push("/m/incidents");
  }

  return (
    <div className="flex-1 px-4 pt-3 pb-[96px]">
      {error && <p className="mb-3 rounded-[8px] bg-[#fdedec] px-3 py-2 text-[16px] text-[#b42318]">{error}</p>}

      <label htmlFor="type" className={mLabel}>
        Incident Type
      </label>
      <select id="type" className={mInput} value={typeId} onChange={(e) => setTypeId(e.target.value)}>
        <option value="">Select…</option>
        {types.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <ErrorLine>{fieldErrors.incident_type_id}</ErrorLine>
      {selectedType?.disables_location && (
        <p className="mt-1.5 text-[15px] text-[#a4570a]">While open, this incident marks its location as not operational.</p>
      )}

      <label htmlFor="location" className={`${mLabel} mt-4`}>
        Location
      </label>
      <select id="location" className={mInput} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
        <option value="">Select…</option>
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      <ErrorLine>{fieldErrors.location_id}</ErrorLine>

      <label htmlFor="comment" className={`${mLabel} mt-4`}>
        Comment
      </label>
      <textarea
        id="comment"
        rows={4}
        className={`${mInput} !h-auto py-3`}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <ErrorLine>{fieldErrors.comment}</ErrorLine>

      <button
        type="button"
        onClick={() => setShowPhotos(true)}
        className="mt-4 flex h-[60px] w-full items-center justify-between rounded-[8px] bg-[#ababab] pr-2 pl-4 text-white"
      >
        <span className="flex-1 text-center text-[20px] font-semibold tracking-wide">INCIDENT IMAGES</span>
        <span
          className={`flex h-[46px] items-center gap-2 rounded-[6px] px-4 text-[20px] ${
            selectedType?.is_image_required && usable.length === 0 ? "bg-[#d97706]" : "bg-[#0b86d8]"
          }`}
        >
          <CameraIcon className="h-5 w-5" />
          {usable.length}
        </span>
      </button>

      <FormFooter>
        <button type="button" disabled={isPending} onClick={() => setConfirmCancel(true)} className={mBtnLight}>
          Cancel
        </button>
        <button type="button" disabled={isPending || uploading} onClick={save} className={mBtnGreen}>
          {isPending ? "Saving…" : uploading ? "Uploading…" : "Save"}
        </button>
      </FormFooter>

      <ConfirmDialog open={confirmCancel} onProceed={cancel} onCancel={() => setConfirmCancel(false)} />

      {showPhotos && (
        <Sheet
          title="Incident Images"
          onClose={() => setShowPhotos(false)}
          footer={
            <button type="button" className={`${mBtnGreen} w-full`} onClick={() => setShowPhotos(false)}>
              Save &amp; Close
            </button>
          }
        >
          <div className="p-4">
            <PhotoPicker images={images} onChange={setImages} required={selectedType?.is_image_required} />
          </div>
        </Sheet>
      )}
    </div>
  );
}
