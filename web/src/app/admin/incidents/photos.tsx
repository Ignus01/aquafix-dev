"use client";

import { useRef, useState, useTransition } from "react";
import { CameraIcon, DownloadIcon, XIcon } from "../icons";
import { discardUploads, uploadIncidentImage } from "@/lib/incidents/image-upload";
import type { FormImage, IncidentImage } from "@/lib/incidents/types";
import { getImageDownloadUrl } from "./actions";

// Signed Storage URLs don't go through next/image's optimiser, and thumbnails
// are already resized at upload.
function Img({ src, alt, className }: { src: string; alt: string; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} loading="lazy" />;
}

// ============================================================================
// PhotoPicker — the photo section of Incident_NewEdit and Incident_AddNote.
// Files upload as soon as they're picked; the form links them on Save.
// ============================================================================
export function PhotoPicker({
  images,
  onChange,
  disabled,
  required,
}: {
  images: FormImage[];
  onChange: (update: (prev: FormImage[]) => FormImage[]) => void;
  disabled?: boolean;
  required?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Tiles removed while their upload was still running.
  const removedKeys = useRef(new Set<string>());

  async function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const picked = Array.from(files).map((file) => ({ file, key: crypto.randomUUID() }));
    onChange((prev) => [
      ...prev,
      ...picked.map(({ key }) => ({
        key,
        id: null,
        thumb_url: null,
        upload: null,
        uploading: true,
        error: null,
      })),
    ]);
    await Promise.all(
      picked.map(async ({ file, key }) => {
        try {
          const { image, previewUrl } = await uploadIncidentImage(file);
          if (removedKeys.current.has(key)) {
            void discardUploads([image]);
            return;
          }
          onChange((prev) =>
            prev.map((p) =>
              p.key === key ? { ...p, upload: image, thumb_url: previewUrl, uploading: false } : p,
            ),
          );
        } catch (e) {
          const message = e instanceof Error ? e.message : "Upload failed.";
          onChange((prev) =>
            prev.map((p) => (p.key === key ? { ...p, uploading: false, error: message } : p)),
          );
        }
      }),
    );
  }

  function remove(image: FormImage) {
    // A new, unsaved upload can go straight away; an existing photo is only
    // unlinked when the form is saved.
    if (image.upload && !image.id) void discardUploads([image.upload]);
    removedKeys.current.add(image.key);
    onChange((prev) => prev.filter((p) => p.key !== image.key));
  }

  const count = images.filter((i) => !i.error).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] font-semibold tracking-wider text-muted uppercase">
          Photos{required && <span className="ml-1 text-danger">*</span>}
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          className="flex h-[34px] items-center gap-1.5 rounded-control border border-border bg-white px-3 text-[13px] font-semibold text-ink transition-colors hover:bg-black/[.03] disabled:opacity-60"
        >
          <CameraIcon className="h-4 w-4" />
          Add photo{count > 0 && <span className="text-muted">({count})</span>}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            void addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {required && count === 0 && (
        <p className="text-xs text-muted">Photos are required for this incident type.</p>
      )}

      {images.length > 0 && (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {images.map((image) => (
            <div
              key={image.key}
              className="relative aspect-square overflow-hidden rounded-control border border-border bg-table-head"
            >
              {image.thumb_url && (
                <Img src={image.thumb_url} alt="Incident photo" className="h-full w-full object-cover" />
              )}
              {image.uploading && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-xs font-medium text-muted">
                  Uploading…
                </div>
              )}
              {image.error && (
                <div className="absolute inset-0 flex items-center justify-center p-2 text-center text-[11px] text-danger">
                  {image.error}
                </div>
              )}
              {!disabled && !image.uploading && (
                <button
                  type="button"
                  onClick={() => remove(image)}
                  aria-label="Remove photo"
                  className="absolute top-1 right-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Gallery — read-only thumbnails with a click-to-enlarge viewer
// (Incident_View / Incident_ViewImages). Admins get "Download".
// ============================================================================
export function Gallery({
  images,
  canDownload,
  emptyLabel,
  small,
}: {
  images: IncidentImage[];
  canDownload: boolean;
  emptyLabel?: string;
  small?: boolean;
}) {
  const [open, setOpen] = useState<IncidentImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function download(image: IncidentImage) {
    setError(null);
    startTransition(async () => {
      const res = await getImageDownloadUrl(image.id);
      if (res.error || !res.url) setError(res.error ?? "Could not download.");
      else window.location.assign(res.url);
    });
  }

  if (images.length === 0) {
    return emptyLabel ? <p className="text-[13px] text-muted">{emptyLabel}</p> : null;
  }

  return (
    <>
      <div
        className={
          small ? "flex flex-wrap gap-2" : "grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5"
        }
      >
        {images.map((image) => (
          <button
            key={image.id}
            type="button"
            onClick={() => setOpen(image)}
            className={`overflow-hidden rounded-control border border-border bg-table-head transition-opacity hover:opacity-90 ${
              small ? "h-16 w-16" : "aspect-square"
            }`}
          >
            {image.thumb_url ? (
              <Img src={image.thumb_url} alt="Incident photo" className="h-full w-full object-cover" />
            ) : (
              <span className="text-xs text-muted">Unavailable</span>
            )}
          </button>
        ))}
      </div>

      {open && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-black/90" role="dialog" aria-modal="true">
          <div className="flex items-center justify-end gap-2 p-3">
            {canDownload && (
              <button
                type="button"
                disabled={isPending}
                onClick={() => download(open)}
                className="flex h-[36px] items-center gap-1.5 rounded-control bg-white/10 px-3 text-[13px] font-semibold text-white transition-colors hover:bg-white/20 disabled:opacity-60"
              >
                <DownloadIcon className="h-4 w-4" />
                {isPending ? "Preparing…" : "Download image"}
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(null)}
              aria-label="Close"
              className="flex h-[36px] w-[36px] items-center justify-center rounded-control bg-white/10 text-white transition-colors hover:bg-white/20"
            >
              <XIcon className="h-5 w-5" />
            </button>
          </div>
          {error && <p className="px-4 text-center text-sm text-red-300">{error}</p>}
          <div
            className="flex min-h-0 flex-1 items-center justify-center p-4"
            onClick={() => setOpen(null)}
          >
            {open.url && (
              <Img src={open.url} alt="Incident photo" className="max-h-full max-w-full object-contain" />
            )}
          </div>
        </div>
      )}
    </>
  );
}
