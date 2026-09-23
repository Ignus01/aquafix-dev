"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { discardUploads } from "@/lib/incidents/image-upload";
import type {
  FieldErrors,
  FormImage,
  IncidentDetail,
  IncidentTypeOption,
  LocationOption,
  NewImage,
} from "@/lib/incidents/types";
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass } from "../ui";
import { saveIncident } from "./actions";
import { PhotoPicker } from "./photos";

// Incident_NewEdit — used for both New and Edit.
export function IncidentForm({
  incident,
  types,
  locations,
}: {
  incident: IncidentDetail | null;
  types: IncidentTypeOption[];
  locations: LocationOption[];
}) {
  const router = useRouter();
  const [typeId, setTypeId] = useState(incident?.incident_type.id ?? "");
  const [locationId, setLocationId] = useState(incident?.location.id ?? "");
  const [comment, setComment] = useState(incident?.comment ?? "");
  const [images, setImages] = useState<FormImage[]>(
    (incident?.images ?? []).map((i) => ({
      key: i.id,
      id: i.id,
      thumb_url: i.thumb_url,
      upload: null,
      uploading: false,
      error: null,
    })),
  );
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // New choices are limited to active types and active asset-manager
  // locations (the Mendix combobox constraints); the current value stays.
  const typeOptions = types.filter((t) => t.active || t.id === incident?.incident_type.id);
  const locationOptions = locations.filter(
    (l) => (l.active && l.is_asset_manager) || l.id === incident?.location.id,
  );
  const selectedType = types.find((t) => t.id === typeId);
  const uploading = images.some((i) => i.uploading);
  const usableImages = images.filter((i) => !i.error && (i.id || i.upload));
  const backHref = incident ? `/admin/incidents/${incident.reference}` : "/admin/incidents";

  function newUploads(list: FormImage[]): NewImage[] {
    return list.filter((i) => !i.id && i.upload).map((i) => i.upload!);
  }

  function save() {
    setError(null);
    // Incident_Validate, with the type checked first (see actions.ts).
    const errors: FieldErrors = {};
    if (!typeId) errors.incident_type_id = "Required";
    if (!locationId) errors.location_id = "Required";
    if (!comment.trim()) errors.comment = "Required";
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    // ICD-R02
    if (selectedType?.is_image_required && usableImages.length === 0) {
      setError("Please add images.");
      return;
    }

    startTransition(async () => {
      const res = await saveIncident({
        id: incident?.id ?? null,
        incident_type_id: typeId,
        location_id: locationId,
        comment,
        images: usableImages.map((i) => (i.id ? { id: i.id } : { id: null, ...i.upload! })),
      });
      if (res.fieldErrors) setFieldErrors(res.fieldErrors);
      if (res.error) setError(res.error);
      if (res.reference !== undefined) router.push(`/admin/incidents/${res.reference}`);
    });
  }

  function cancel() {
    void discardUploads(newUploads(images));
    router.push(backHref);
  }

  return (
    <div className="px-4 pb-10 md:px-8">
      <div className="max-w-2xl rounded-card border border-border bg-card">
        <div className="flex flex-col gap-5 p-5 md:p-6">
          {error && (
            <p className="border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">{error}</p>
          )}

          <div className="flex flex-col gap-1.5">
            <label htmlFor="incident-type" className={labelClass}>
              Incident type
            </label>
            <select
              id="incident-type"
              className={inputClass}
              value={typeId}
              onChange={(e) => setTypeId(e.target.value)}
            >
              <option value="">Select…</option>
              {typeOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {!t.active ? " (inactive)" : ""}
                </option>
              ))}
            </select>
            {fieldErrors.incident_type_id && (
              <span className="text-xs text-danger">{fieldErrors.incident_type_id}</span>
            )}
            {selectedType?.disables_location && (
              <span className="text-xs text-warning">
                While this incident is open, its location shows as not operational.
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="incident-location" className={labelClass}>
              Location
            </label>
            <select
              id="incident-location"
              className={inputClass}
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              <option value="">Select…</option>
              {locationOptions.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            {fieldErrors.location_id && (
              <span className="text-xs text-danger">{fieldErrors.location_id}</span>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="incident-comment" className={labelClass}>
              Comment
            </label>
            <textarea
              id="incident-comment"
              rows={5}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="What happened?"
              className={`${inputClass} !h-auto py-2.5`}
            />
            {fieldErrors.comment && <span className="text-xs text-danger">{fieldErrors.comment}</span>}
          </div>

          <PhotoPicker
            images={images}
            onChange={setImages}
            disabled={isPending}
            required={selectedType?.is_image_required}
          />
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-4 md:px-6">
          <button type="button" disabled={isPending} onClick={cancel} className={secondaryButtonClass}>
            Cancel
          </button>
          <button
            type="button"
            disabled={isPending || uploading}
            onClick={save}
            className={primaryButtonClass}
          >
            {isPending ? "Saving…" : uploading ? "Uploading…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
