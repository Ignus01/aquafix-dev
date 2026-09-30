"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { formatDateTime } from "@/lib/incidents/format";
import { isoToZonedInput, zonedInputToIso } from "@/lib/inspections/dates";
import { discardServiceUploads, uploadServiceFile } from "@/lib/services/file-upload";
import {
  SERVICE_TYPES,
  SERVICE_TYPE_LABELS,
  type AssetOption,
  type FieldErrors,
  type FormFile,
  type NewFile,
  type ServiceDetail,
  type ServiceType,
  type SupplierOption,
} from "@/lib/services/types";
import { PaperclipIcon, XIcon } from "../icons";
import { Switch } from "../switch";
import {
  dangerLinkButtonClass,
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  sectionHeadingClass,
} from "../ui";
import { deleteService, getServiceFileUrl, saveService } from "./actions";
import { formatFileSize, formatMoney } from "./format";

const toNumber = (value: string) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// Service_NewEdit (web) and Service_Edit "Complete Service" (phone): the same
// form. Completed reveals the completion date, supplier, financial detail and
// documents.
export function ServiceForm({
  service,
  assets,
  suppliers,
  timeZone,
  canEdit,
  canRemoveFiles,
  startCompleted,
  notice,
}: {
  service: ServiceDetail | null;
  assets: AssetOption[];
  suppliers: SupplierOption[];
  timeZone: string;
  canEdit: boolean;
  // Only admins may delete files that are already saved.
  canRemoveFiles: boolean;
  // ACT_Service_Complete: Completed ticked and the date set to now.
  startCompleted: boolean;
  notice: string | null;
}) {
  const router = useRouter();
  const nowInput = () => isoToZonedInput(new Date().toISOString(), timeZone);

  const [assetId, setAssetId] = useState(service?.asset.id ?? "");
  const [serviceType, setServiceType] = useState<ServiceType | "">(service?.service_type ?? "");
  const [dueDate, setDueDate] = useState(service ? isoToZonedInput(service.due_date, timeZone) : nowInput());
  const [completed, setCompleted] = useState(startCompleted || (service?.is_completed ?? false));
  const [completedDate, setCompletedDate] = useState(
    service?.completed_date ? isoToZonedInput(service.completed_date, timeZone) : startCompleted ? nowInput() : "",
  );
  const [supplierId, setSupplierId] = useState(service?.supplier?.id ?? "");
  const [invoiceNr, setInvoiceNr] = useState(service?.invoice_nr ?? "");
  const [partCost, setPartCost] = useState(service?.total_part_cost ? String(service.total_part_cost) : "");
  const [labourCost, setLabourCost] = useState(service?.total_labour_cost ? String(service.total_labour_cost) : "");
  const [comment, setComment] = useState(service?.comment ?? "");
  const [files, setFiles] = useState<FormFile[]>(
    (service?.files ?? []).map((f) => ({
      key: f.id,
      id: f.id,
      name: f.name,
      size_bytes: f.size_bytes,
      upload: null,
      uploading: false,
      error: null,
    })),
  );
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  // Files removed while their upload was still running.
  const removedKeys = useRef(new Set<string>());

  // New choices are limited to active assets and service suppliers; the
  // current value stays even if it was deactivated since.
  const assetOptions = assets.filter((a) => a.active || a.id === service?.asset.id);
  const supplierOptions = suppliers.filter((s) => s.active || s.id === service?.supplier?.id);
  if (service?.supplier && !supplierOptions.some((s) => s.id === service.supplier!.id)) {
    supplierOptions.push({ id: service.supplier.id, name: service.supplier.name, active: false });
  }

  const uploading = files.some((f) => f.uploading);
  const total = toNumber(partCost) + toNumber(labourCost);
  const disabled = !canEdit || isPending;

  function toggleCompleted(on: boolean) {
    setCompleted(on);
    if (on && !completedDate) setCompletedDate(nowInput());
  }

  async function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    const picked = [...list].map((file) => ({ file, key: crypto.randomUUID() }));
    setFiles((prev) => [
      ...prev,
      ...picked.map(({ file, key }) => ({
        key,
        id: null,
        name: file.name,
        size_bytes: file.size,
        upload: null,
        uploading: true,
        error: null,
      })),
    ]);
    await Promise.all(
      picked.map(async ({ file, key }) => {
        try {
          const upload = await uploadServiceFile(file);
          if (removedKeys.current.has(key)) {
            void discardServiceUploads([upload]);
            return;
          }
          setFiles((prev) => prev.map((f) => (f.key === key ? { ...f, upload, uploading: false } : f)));
        } catch (e) {
          const message = e instanceof Error ? e.message : "Upload failed.";
          setFiles((prev) => prev.map((f) => (f.key === key ? { ...f, uploading: false, error: message } : f)));
        }
      }),
    );
  }

  function removeFile(file: FormFile) {
    // A new, unsaved upload can go straight away; a saved file is only
    // unlinked when the form is saved.
    if (file.upload && !file.id) void discardServiceUploads([file.upload]);
    removedKeys.current.add(file.key);
    setFiles((prev) => prev.filter((f) => f.key !== file.key));
  }

  function download(file: FormFile) {
    if (!file.id) return;
    setError(null);
    startTransition(async () => {
      const res = await getServiceFileUrl(file.id!);
      if (res.error || !res.url) setError(res.error ?? "Could not download.");
      else window.location.assign(res.url);
    });
  }

  function newUploads(): NewFile[] {
    return files.filter((f) => !f.id && f.upload).map((f) => f.upload!);
  }

  function save() {
    setError(null);
    // Service_Validate's required fields; save_service repeats every check.
    const errors: FieldErrors = {};
    if (!serviceType) errors.service_type = "Required";
    if (!dueDate) errors.due_date = "Required";
    if (!assetId) errors.asset_id = "Required";
    if (completed) {
      if (!completedDate) errors.completed_date = "Required";
      if (!supplierId) errors.supplier_id = "Required";
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    startTransition(async () => {
      const res = await saveService({
        id: service?.id ?? null,
        asset_id: assetId,
        service_type: serviceType,
        due_date: zonedInputToIso(dueDate, timeZone),
        is_completed: completed,
        completed_date: completed ? zonedInputToIso(completedDate, timeZone) : "",
        supplier_id: completed ? supplierId : "",
        invoice_nr: completed ? invoiceNr : "",
        total_part_cost: completed ? toNumber(partCost) : 0,
        total_labour_cost: completed ? toNumber(labourCost) : 0,
        comment,
        files: files
          .filter((f) => !f.error && (f.id || f.upload))
          .map((f) => (f.id ? { id: f.id } : { id: null, ...f.upload! })),
      });
      if (res.fieldErrors) setFieldErrors(res.fieldErrors);
      if (res.error) setError(res.error);
      if (res.reference === undefined) return;
      // A completed scheduled maintenance opens the next service instead of
      // closing the page, for the user to confirm.
      router.push(res.nextService ? `/admin/services/${res.nextService.reference}?next=1` : "/admin/services");
    });
  }

  function cancel() {
    void discardServiceUploads(newUploads());
    router.push("/admin/services");
  }

  function remove() {
    if (!service) return;
    if (!window.confirm(`Delete service ${service.reference}? Its files are deleted too.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteService(service.id);
      if (res.error) setError(res.error);
      else router.push("/admin/services");
    });
  }

  return (
    <div className="px-4 pb-10 md:px-8">
      <div className="max-w-2xl rounded-card border border-border bg-card">
        <div className="flex flex-col gap-5 p-5 md:p-6">
          {notice && (
            <p className="border-l-2 border-primary bg-primary/5 py-2 pl-3 text-[13px] text-ink">{notice}</p>
          )}
          {error && <p className="border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">{error}</p>}
          {!canEdit && <p className="text-[13px] text-muted">You have read-only access to services.</p>}

          <Field id="service-asset" label="Asset" error={fieldErrors.asset_id}>
            <select
              id="service-asset"
              className={inputClass}
              value={assetId}
              disabled={disabled}
              onChange={(e) => setAssetId(e.target.value)}
            >
              <option value="">Select…</option>
              {assetOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.code}){!a.active ? " (inactive)" : ""}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="service-type" label="Service type" error={fieldErrors.service_type}>
              <select
                id="service-type"
                className={inputClass}
                value={serviceType}
                disabled={disabled}
                onChange={(e) => setServiceType(e.target.value as ServiceType | "")}
              >
                <option value="">Select…</option>
                {SERVICE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {SERVICE_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="service-due" label="Due date" error={fieldErrors.due_date}>
              <input
                id="service-due"
                type="datetime-local"
                className={inputClass}
                value={dueDate}
                disabled={disabled}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </Field>
          </div>

          <Field id="service-comment" label={`Comment (${comment.length}/200)`}>
            <textarea
              id="service-comment"
              rows={3}
              maxLength={200}
              value={comment}
              disabled={disabled}
              onChange={(e) => setComment(e.target.value)}
              className={`${inputClass} !h-auto py-2.5`}
            />
          </Field>

          <Switch checked={completed} onChange={toggleCompleted} label="Completed" disabled={disabled} />

          {completed && (
            <>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field id="service-completed-date" label="Completed date" error={fieldErrors.completed_date}>
                  <input
                    id="service-completed-date"
                    type="datetime-local"
                    className={inputClass}
                    value={completedDate}
                    disabled={disabled}
                    onChange={(e) => setCompletedDate(e.target.value)}
                  />
                </Field>
                <Field id="service-supplier" label="Service supplier" error={fieldErrors.supplier_id}>
                  <select
                    id="service-supplier"
                    className={inputClass}
                    value={supplierId}
                    disabled={disabled}
                    onChange={(e) => setSupplierId(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {supplierOptions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {!s.active ? " (inactive)" : ""}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <fieldset className="flex flex-col gap-4 rounded-control border border-border p-4">
                <legend className={`px-1 ${sectionHeadingClass}`}>Financial detail</legend>
                <Field id="service-invoice" label="Invoice nr">
                  <input
                    id="service-invoice"
                    className={inputClass}
                    value={invoiceNr}
                    disabled={disabled}
                    onChange={(e) => setInvoiceNr(e.target.value)}
                  />
                </Field>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field id="service-part-cost" label="Part cost">
                    <input
                      id="service-part-cost"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      className={inputClass}
                      value={partCost}
                      disabled={disabled}
                      onChange={(e) => setPartCost(e.target.value)}
                    />
                  </Field>
                  <Field id="service-labour-cost" label="Labour cost">
                    <input
                      id="service-labour-cost"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      className={inputClass}
                      value={labourCost}
                      disabled={disabled}
                      onChange={(e) => setLabourCost(e.target.value)}
                    />
                  </Field>
                  <Field id="service-total-cost" label="Total cost">
                    <input
                      id="service-total-cost"
                      className={`${inputClass} font-semibold tabular-nums`}
                      value={formatMoney(total)}
                      readOnly
                      disabled
                    />
                  </Field>
                </div>
              </fieldset>

              <fieldset className="flex flex-col gap-3 rounded-control border border-border p-4">
                <legend className={`px-1 ${sectionHeadingClass}`}>Document management</legend>
                {canEdit && (
                  <div>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => fileInput.current?.click()}
                      className="flex h-[34px] items-center gap-1.5 rounded-control border border-border bg-white px-3 text-[13px] font-semibold text-ink transition-colors hover:bg-black/[.03] disabled:opacity-60"
                    >
                      <PaperclipIcon className="h-4 w-4" />
                      Add new file
                    </button>
                    <input
                      ref={fileInput}
                      type="file"
                      multiple
                      hidden
                      onChange={(e) => {
                        void addFiles(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </div>
                )}
                {files.length === 0 ? (
                  <p className="text-[13px] text-muted">No files.</p>
                ) : (
                  <ul className="divide-y divide-border rounded-control border border-border">
                    {files.map((file) => {
                      const saved = service?.files.find((f) => f.id === file.id);
                      return (
                        <li key={file.key} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                          <div className="flex min-w-0 flex-1 flex-col">
                            {file.id ? (
                              <button
                                type="button"
                                onClick={() => download(file)}
                                className="truncate text-left font-medium text-primary hover:text-primary-hover"
                              >
                                {file.name}
                              </button>
                            ) : (
                              <span className="truncate font-medium text-ink">{file.name}</span>
                            )}
                            <span className="text-xs text-muted">
                              {formatFileSize(file.size_bytes)}
                              {saved && ` · ${formatDateTime(saved.created_at, timeZone)}`}
                              {saved?.created_by_name && ` · ${saved.created_by_name}`}
                              {file.uploading && " · Uploading…"}
                              {!file.id && !file.uploading && !file.error && " · Not saved yet"}
                            </span>
                            {file.error && <span className="text-xs text-danger">{file.error}</span>}
                          </div>
                          {canEdit && !file.uploading && (file.id === null || canRemoveFiles) && (
                            <button
                              type="button"
                              onClick={() => removeFile(file)}
                              aria-label={`Remove ${file.name}`}
                              className="rounded-control p-1.5 text-muted transition-colors hover:bg-black/[.04] hover:text-ink"
                            >
                              <XIcon className="h-4 w-4" />
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </fieldset>
            </>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border px-5 py-4 md:px-6">
          <div>
            {canEdit && service && (
              <button type="button" disabled={isPending} onClick={remove} className={dangerLinkButtonClass}>
                Delete service
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={isPending} onClick={cancel} className={secondaryButtonClass}>
              {canEdit ? "Cancel" : "Back"}
            </button>
            {canEdit && (
              <button
                type="button"
                disabled={isPending || uploading}
                onClick={save}
                className={primaryButtonClass}
              >
                {isPending ? "Saving…" : uploading ? "Uploading…" : "Save"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children}
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}
