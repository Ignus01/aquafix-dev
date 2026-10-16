"use client";

import Link from "next/link";
import { useMemo, useRef, useState, useTransition } from "react";
import { formatDay } from "@/lib/dashboard/format";
import { MAX_LAB_FILES } from "@/lib/quality/constants";
import { formatResult } from "@/lib/quality/evaluate";
import { uploadLabFile } from "@/lib/quality/file-upload";
import {
  IGNORE,
  buildPreview,
  initialChoices,
  mappingErrors,
  mappingItems,
  needsFactor,
  parseFactor,
  resolveLabs,
  type Choices,
  type ImportData,
  type ParamChoice,
  type PreviewRow,
} from "@/lib/quality/import-plan";
import type { QualityParameter } from "@/lib/quality/types";
import { UploadIcon } from "../../icons";
import { Switch } from "../../switch";
import {
  cellInputClass,
  primaryButtonClass,
  secondaryButtonClass,
  sectionHeadingClass,
  tableHeadCellClass,
} from "../../ui";
import { cancelImports } from "../actions";
import { OutOfSpec, ResultValue } from "../result-cell";
import { commitLabImport, getImportContext, stageLabImport } from "./actions";
import { NewParameterModal, SearchSelect } from "./pickers";

type Step = "upload" | "map" | "preview" | "done";
type Upload = { key: string; name: string; state: "uploading" | "staged" | "failed"; message?: string; importId?: string };

const NEW_PARAMETER = "__new";

const STATE_TEXT: Record<PreviewRow["state"], string> = {
  new: "New",
  existing: "Already imported, skip",
  replace: "Already imported, replace",
  ignored: "Skipped (locality ignored)",
  duplicate: "Duplicate in this upload",
};

const card = "rounded-card border border-border bg-card";

// Upload → Map → Preview → Import. Map only shows when something in the
// files has no saved mapping yet.
export function ImportWizard({
  initialContext,
  missingStaged,
}: {
  initialContext: ImportData | null;
  missingStaged: boolean;
}) {
  const [data, setData] = useState<ImportData | null>(initialContext);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [labChoice, setLabChoice] = useState<Record<string, string>>({});
  const [paramOverrides, setParamOverrides] = useState<Record<string, ParamChoice>>({});
  const [localityOverrides, setLocalityOverrides] = useState<Record<string, string>>({});
  const [replace, setReplace] = useState(false);
  const [newParamFor, setNewParamFor] = useState<{ key: string; header: string; unit: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ files: number; imported: number; skipped: number; replaced: number } | null>(
    null,
  );
  const [pending, startTransition] = useTransition();
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // ---- Derived plan --------------------------------------------------------
  const labs = useMemo(
    () => (data ? resolveLabs(data, { labs: labChoice, params: {}, localities: {} }) : []),
    [data, labChoice],
  );
  const items = useMemo(() => (data ? mappingItems(data, labs) : { params: [], localities: [] }), [data, labs]);
  const choices: Choices = useMemo(() => {
    const initial = initialChoices(items);
    return {
      labs: labChoice,
      params: Object.fromEntries(items.params.map((p) => [p.key, paramOverrides[p.key] ?? initial.params[p.key]])),
      localities: Object.fromEntries(
        items.localities.map((l) => [l.key, localityOverrides[l.key] ?? initial.localities[l.key]]),
      ),
    };
  }, [items, labChoice, paramOverrides, localityOverrides]);
  const newLabs = labs.filter((l) => !l.matched);
  const needsMap = items.params.length > 0 || items.localities.length > 0 || newLabs.length > 0;
  const [step, setStep] = useState<Step>(() => {
    if (!initialContext) return "upload";
    const l = resolveLabs(initialContext, { labs: {}, params: {}, localities: {} });
    const it = mappingItems(initialContext, l);
    return it.params.length || it.localities.length || l.some((x) => !x.matched) ? "map" : "preview";
  });

  const errors = useMemo(() => (data ? mappingErrors(data, choices, labs) : []), [data, choices, labs]);
  const paramById = useMemo(() => new Map((data?.parameters ?? []).map((p) => [p.id, p])), [data]);
  const incomplete =
    items.params.some((p) => {
      const c = choices.params[p.key];
      if (!c?.parameterId) return true;
      if (c.parameterId === IGNORE) return false;
      return needsFactor(p, paramById.get(c.parameterId)) && parseFactor(c.factor) === null;
    }) || items.localities.some((l) => !choices.localities[l.key]);

  const preview = useMemo(
    () => (data && step === "preview" ? buildPreview(data, choices, labs, replace) : null),
    [data, choices, labs, replace, step],
  );

  // ---- Upload --------------------------------------------------------------
  async function addFiles(list: FileList | File[]) {
    setError(null);
    const files = [...list];
    const room = MAX_LAB_FILES - uploads.filter((u) => u.state !== "failed").length;
    if (files.length > room) setError(`You can import up to ${MAX_LAB_FILES} files at a time.`);
    const batch = files.slice(0, Math.max(0, room)).map((file) => ({
      file,
      upload: { key: crypto.randomUUID(), name: file.name, state: "uploading" as const },
    }));
    setUploads((u) => [...u, ...batch.map((b) => b.upload)]);
    const update = (key: string, patch: Partial<Upload>) =>
      setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...patch } : x)));
    for (const { file, upload } of batch) {
      try {
        const path = await uploadLabFile(file);
        const res = await stageLabImport(path, file.name);
        if (res.error !== null) update(upload.key, { state: "failed", message: res.error });
        else update(upload.key, { state: "staged", importId: res.import.id });
      } catch (e) {
        update(upload.key, { state: "failed", message: e instanceof Error ? e.message : "Upload failed." });
      }
    }
  }

  const stagedIds = uploads.filter((u) => u.state === "staged").map((u) => u.importId!);
  const uploading = uploads.some((u) => u.state === "uploading");

  function toMapOrPreview() {
    setError(null);
    startTransition(async () => {
      try {
        const ctx = await getImportContext(stagedIds);
        if (ctx.imports.length === 0) {
          setError("These files are no longer staged. Upload them again.");
          return;
        }
        setData(ctx);
        const l = resolveLabs(ctx, { labs: labChoice, params: {}, localities: {} });
        const it = mappingItems(ctx, l);
        setStep(it.params.length || it.localities.length || l.some((x) => !x.matched) ? "map" : "preview");
      } catch {
        setError("Couldn't read the staged files. Try again.");
      }
    });
  }

  // ---- Import --------------------------------------------------------------
  function commit() {
    if (!data) return;
    setError(null);
    startTransition(async () => {
      const res = await commitLabImport({
        importIds: data.imports.map((i) => i.id),
        lab: Object.fromEntries(
          labs.filter((l) => labChoice[l.key]).map((l) => [l.name, labChoice[l.key]]),
        ),
        parameterMaps: items.params.map((p) => {
          const c = choices.params[p.key];
          const param = c.parameterId !== IGNORE ? paramById.get(c.parameterId) : undefined;
          return {
            lab_name: p.labName,
            lab_parameter: p.header,
            lab_unit: p.unit || null,
            parameter_id: param ? param.id : null,
            factor: param && needsFactor(p, param) ? (parseFactor(c.factor) ?? 1) : 1,
          };
        }),
        locationMaps: items.localities.map((l) => {
          const c = choices.localities[l.key];
          return {
            lab_name: l.labName,
            lab_locality: l.locality,
            location_id: c === IGNORE ? null : c,
          };
        }),
        replace,
      });
      if (res.error) setError(res.error);
      else {
        setResult(res.result ?? null);
        setStep("done");
      }
    });
  }

  function cancel() {
    if (!data && stagedIds.length === 0) return;
    if (!confirm("Cancel this import? The uploaded files are removed.")) return;
    const ids = data ? data.imports.map((i) => i.id) : stagedIds;
    startTransition(async () => {
      const res = await cancelImports(ids);
      if (res.error) setError(res.error);
      else restart();
    });
  }

  function restart() {
    setData(null);
    setUploads([]);
    setLabChoice({});
    setParamOverrides({});
    setLocalityOverrides({});
    setReplace(false);
    setResult(null);
    setError(null);
    setStep("upload");
  }

  function onParameterCreated(key: string, p: QualityParameter) {
    setData((d) => (d ? { ...d, parameters: [...d.parameters, p] } : d));
    setParamOverrides((o) => ({ ...o, [key]: { parameterId: p.id, factor: o[key]?.factor ?? "1" } }));
    setNewParamFor(null);
  }

  // ---- Render ----------------------------------------------------------------
  const steps: { key: Step; label: string }[] = [
    { key: "upload", label: "Upload" },
    ...(needsMap || step === "map" ? [{ key: "map" as Step, label: "Map" }] : []),
    { key: "preview", label: "Preview" },
    { key: "done", label: "Import" },
  ];
  const stepIndex = steps.findIndex((s) => s.key === step);

  const parameterOptions = (data?.parameters ?? [])
    .filter((p) => p.active)
    .map((p) => ({ value: p.id, label: `${p.name} (${p.unit})` }));
  const locationOptions = (data?.locations ?? []).filter((l) => l.active).map((l) => ({ value: l.id, label: l.name }));

  return (
    <div className="flex flex-col gap-6 px-4 pb-10 md:px-8">
      <ol className="flex flex-wrap items-center gap-2 text-[13px]" aria-label="Steps">
        {steps.map((s, i) => (
          <li key={s.key} className="flex items-center gap-2">
            <span
              aria-current={i === stepIndex ? "step" : undefined}
              className={`flex items-center gap-2 rounded-full px-3 py-1 font-semibold ${
                i === stepIndex
                  ? "bg-primary text-white"
                  : i < stepIndex
                    ? "bg-primary/10 text-primary"
                    : "bg-black/[.04] text-muted"
              }`}
            >
              <span className="tabular-nums">{i + 1}</span>
              {s.label}
            </span>
            {i < steps.length - 1 && <span className="text-muted">→</span>}
          </li>
        ))}
      </ol>

      {missingStaged && step === "upload" && (
        <p className="border-l-2 border-warning py-1 pl-3 text-[13px] text-warning">
          Those imports are no longer staged (already imported or cancelled). Upload the files again to import them.
        </p>
      )}
      {error && <p className="border-l-2 border-danger py-1 pl-3 text-[13px] whitespace-pre-line text-danger">{error}</p>}

      {step === "upload" && (
        <>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
            }}
            onClick={() => fileInput.current?.click()}
            className={`flex cursor-pointer flex-col items-center gap-2 rounded-card border-2 border-dashed px-6 py-10 text-center transition-colors ${
              dragging ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/60"
            }`}
          >
            <UploadIcon className="h-7 w-7 text-primary" />
            <p className="text-sm font-semibold text-ink">Drop lab certificates here, or click to choose</p>
            <p className="text-[13px] text-muted">.xlsx files, up to {MAX_LAB_FILES} at a time, 10 MB each</p>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          {uploads.length > 0 && (
            <ul className={`${card} divide-y divide-border`}>
              {uploads.map((u) => (
                <li key={u.key} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                  <span className="break-all text-ink">{u.name}</span>
                  {u.state === "uploading" && <span className="text-[13px] text-muted">Reading…</span>}
                  {u.state === "staged" && <span className="text-[13px] font-semibold text-success">Ready</span>}
                  {u.state === "failed" && <span className="text-[13px] text-danger">{u.message}</span>}
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap justify-end gap-2.5">
            {stagedIds.length > 0 && (
              <button type="button" className={secondaryButtonClass} disabled={pending || uploading} onClick={cancel}>
                Cancel import
              </button>
            )}
            <button
              type="button"
              className={primaryButtonClass}
              disabled={pending || uploading || stagedIds.length === 0}
              onClick={toMapOrPreview}
            >
              {pending ? "Reading…" : `Next${stagedIds.length ? ` (${stagedIds.length} ${stagedIds.length === 1 ? "file" : "files"})` : ""}`}
            </button>
          </div>
        </>
      )}

      {step === "map" && data && (
        <>
          {labs.length > 0 && newLabs.length > 0 && (
            <section className={`${card} flex flex-col gap-3 p-5`}>
              <h2 className={sectionHeadingClass}>Lab</h2>
              {newLabs.map((l) => (
                <div key={l.key} className="flex flex-wrap items-center gap-3 text-sm text-ink">
                  <span>
                    <span className="font-semibold italic">{l.name}</span>{" "}
                    {labChoice[l.key] ? "will be imported as an existing lab:" : "is a new lab. It will be added."}
                  </span>
                  {data.labs.length > 0 && (
                    <select
                      aria-label={`Lab for ${l.name}`}
                      className={`${cellInputClass} w-auto`}
                      value={labChoice[l.key] ?? ""}
                      onChange={(e) => setLabChoice((c) => ({ ...c, [l.key]: e.target.value }))}
                    >
                      <option value="">Add as a new lab</option>
                      {data.labs.map((x) => (
                        <option key={x.id} value={x.id}>
                          Use {x.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              ))}
            </section>
          )}

          {items.params.length > 0 && (
            <section className={card}>
              <div className="flex flex-col gap-1 px-5 pt-5 pb-3">
                <h2 className={sectionHeadingClass}>Lab parameters</h2>
                <p className="text-[13px] text-muted">
                  Map each new column to an Aquafix parameter, once per lab. Later imports from this lab reuse it.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-table-head">
                      <th className={tableHeadCellClass}>Lab parameter</th>
                      <th className={tableHeadCellClass}>Lab unit</th>
                      <th className={tableHeadCellClass}>Example values</th>
                      <th className={tableHeadCellClass}>Aquafix parameter</th>
                      <th className={tableHeadCellClass}>Factor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.params.map((p) => {
                      const c = choices.params[p.key];
                      const param = paramById.get(c.parameterId);
                      const showFactor = needsFactor(p, param);
                      const canBeNegative = param?.can_be_negative ?? false;
                      const savedParam = p.saved?.parameter_id ? paramById.get(p.saved.parameter_id) : undefined;
                      return (
                        <tr key={p.key} className="border-t border-border align-top">
                          <td className="px-3 py-2.5">
                            <span className="font-mono text-[13px] text-ink">{p.header}</span>
                            {labs.length > 1 && <div className="text-xs text-muted">{p.labName}</div>}
                            {p.saved && (
                              <div className="mt-1 max-w-[260px] text-xs text-warning">
                                Was mapped{savedParam ? ` to ${savedParam.name}` : ""} with unit{" "}
                                <em>{p.saved.lab_unit || "(none)"}</em>; this file says <em>{p.unit || "(none)"}</em>.
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-ink">{p.unit || "—"}</td>
                          <td className="px-3 py-2.5 font-mono text-[13px] whitespace-nowrap text-muted">
                            {p.examples.length
                              ? p.examples
                                  .map((v) => (v < 0 && !canBeNegative ? formatResult(-v, true, 0) : String(v)))
                                  .join(", ")
                              : "—"}
                          </td>
                          <td className="px-3 py-2">
                            <select
                              aria-label={`Parameter for ${p.header}`}
                              className={`${cellInputClass} min-w-[240px] ${c.parameterId ? "" : "border-warning"}`}
                              value={c.parameterId}
                              onChange={(e) => {
                                if (e.target.value === NEW_PARAMETER) {
                                  setNewParamFor({ key: p.key, header: p.header, unit: p.unit });
                                  return;
                                }
                                const v = e.target.value;
                                setParamOverrides((o) => ({ ...o, [p.key]: { parameterId: v, factor: c.factor } }));
                              }}
                            >
                              <option value="">Choose…</option>
                              <option value={IGNORE}>Ignore this column</option>
                              <option value={NEW_PARAMETER}>+ New parameter…</option>
                              <optgroup label="Parameters">
                                {parameterOptions.map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {o.label}
                                  </option>
                                ))}
                                {param && !param.active && <option value={param.id}>{param.name} (inactive)</option>}
                              </optgroup>
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            {showFactor ? (
                              <input
                                aria-label={`Factor for ${p.header}`}
                                type="number"
                                step="any"
                                min="0"
                                className={`${cellInputClass} w-[100px] ${parseFactor(c.factor) === null ? "border-danger" : ""}`}
                                value={c.factor}
                                title={`File value × factor = value in ${param?.unit}`}
                                onChange={(e) =>
                                  setParamOverrides((o) => ({
                                    ...o,
                                    [p.key]: { parameterId: c.parameterId, factor: e.target.value },
                                  }))
                                }
                              />
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {items.localities.length > 0 && (
            <section className={card}>
              <div className="flex flex-col gap-1 px-5 pt-5 pb-3">
                <h2 className={sectionHeadingClass}>Lab localities</h2>
                <p className="text-[13px] text-muted">Map each new locality to an Aquafix location, once per lab.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-table-head">
                      <th className={tableHeadCellClass}>Lab locality</th>
                      <th className={tableHeadCellClass}>Client (A2)</th>
                      <th className={tableHeadCellClass}>Samples</th>
                      <th className={tableHeadCellClass}>Aquafix location</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.localities.map((l) => (
                      <tr key={l.key} className="border-t border-border">
                        <td className="px-3 py-2.5 font-mono text-[13px] text-ink">
                          {l.locality}
                          {labs.length > 1 && <div className="font-sans text-xs text-muted">{l.labName}</div>}
                        </td>
                        <td className="px-3 py-2.5 text-ink">{l.client ?? "—"}</td>
                        <td className="px-3 py-2.5 text-ink tabular-nums">{l.samples}</td>
                        <td className="px-3 py-2">
                          <SearchSelect
                            ariaLabel={`Location for ${l.locality}`}
                            value={choices.localities[l.key]}
                            placeholder="Pick a location…"
                            fixed={[{ value: IGNORE, label: "Ignore (skip these samples)" }]}
                            options={locationOptions}
                            onChange={(v) => setLocalityOverrides((o) => ({ ...o, [l.key]: v }))}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {errors.length > 0 && (
            <p className="border-l-2 border-danger py-1 pl-3 text-[13px] whitespace-pre-line text-danger">
              {errors.join("\n")}
            </p>
          )}

          <div className="flex flex-wrap justify-end gap-2.5">
            <button type="button" className={secondaryButtonClass} disabled={pending} onClick={cancel}>
              Cancel import
            </button>
            <button
              type="button"
              className={primaryButtonClass}
              disabled={pending || incomplete || errors.length > 0}
              onClick={() => setStep("preview")}
            >
              Next
            </button>
          </div>
        </>
      )}

      {step === "preview" && data && preview && (
        <>
          {preview.files.map((f) => (
            <section key={f.imp.id} className={card}>
              <div className="flex flex-col gap-1 px-5 pt-4 pb-3">
                <h2 className="text-sm font-semibold text-ink">
                  {f.labName} · Batch {f.imp.batch_no ?? "—"} · {f.imp.client_name ?? "—"} ·{" "}
                  <span className="font-normal break-all text-muted">{f.imp.file_name}</span>
                </h2>
                {f.imp.parsed.warnings.map((w) => (
                  <p key={w} className="text-xs text-warning">
                    {w}
                  </p>
                ))}
                {f.rows.some((r) => r.location && !r.location.active) && (
                  <p className="text-xs text-warning">A locality is mapped to an inactive location.</p>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="text-sm">
                  <thead>
                    <tr className="bg-table-head">
                      <th className={tableHeadCellClass}>Lab no</th>
                      <th className={tableHeadCellClass}>Location</th>
                      <th className={tableHeadCellClass}>Sampled</th>
                      {f.parameters.map((p) => (
                        <th key={p.id} className={`${tableHeadCellClass} !text-right !normal-case`} title={`${p.name} (${p.unit})`}>
                          {p.short_name ?? p.name}
                        </th>
                      ))}
                      <th className={tableHeadCellClass}>Out of spec</th>
                      <th className={tableHeadCellClass}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {f.rows.map((r, i) => (
                      <tr
                        key={`${r.lab_no}-${i}`}
                        className={`border-t border-border ${r.state === "new" || r.state === "replace" ? "" : "opacity-60"}`}
                      >
                        <td className="px-3 py-2 font-mono text-[13px] text-ink">{r.lab_no}</td>
                        <td className="px-3 py-2 whitespace-nowrap text-ink">
                          {r.location ? (
                            <>
                              {r.location.name}
                              {r.location.name.toLowerCase() !== r.locality.toLowerCase() && (
                                <span className="text-xs text-muted"> (from {r.locality})</span>
                              )}
                              {!r.location.active && <span className="text-xs text-warning"> · inactive</span>}
                            </>
                          ) : (
                            <span className="text-muted">{r.locality}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap text-ink">{formatDay(r.sampled_on)}</td>
                        {f.parameters.map((p) => {
                          const cell = r.cells.get(p.id);
                          return (
                            <td key={p.id} className="px-2 py-1.5 text-right">
                              {cell ? (
                                <ResultValue
                                  r={{
                                    value: cell.value,
                                    below_detection: cell.below,
                                    decimals: p.decimals,
                                    unit: p.unit,
                                    name: p.name,
                                    min_acceptable: p.min_acceptable,
                                    max_acceptable: p.max_acceptable,
                                    status: cell.status,
                                  }}
                                />
                              ) : (
                                <span className="text-muted">—</span>
                              )}
                            </td>
                          );
                        })}
                        <td className="px-3 py-2">
                          <OutOfSpec count={r.outOfSpec.length} names={r.outOfSpec} />
                        </td>
                        <td className="px-3 py-2 text-[13px] whitespace-nowrap text-ink">{STATE_TEXT[r.state]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}

          <div className={`${card} flex flex-wrap items-center justify-between gap-3 px-5 py-4`}>
            <p className="text-sm text-ink">
              <span className="font-semibold">
                {preview.totals.new + preview.totals.replace}{" "}
                {preview.totals.new + preview.totals.replace === 1 ? "sample" : "samples"} to import
              </span>
              {" · "}
              {preview.totals.existing + preview.totals.replace} already imported
              {preview.totals.replace > 0 && " (replaced)"}
              {" · "}
              {preview.totals.ignored + preview.totals.duplicate} skipped
            </p>
            {preview.totals.existing + preview.totals.replace > 0 && (
              <Switch label="Replace existing samples" checked={replace} onChange={setReplace} />
            )}
          </div>

          <div className="flex flex-wrap justify-end gap-2.5">
            <button type="button" className={secondaryButtonClass} disabled={pending} onClick={cancel}>
              Cancel import
            </button>
            {needsMap && (
              <button type="button" className={secondaryButtonClass} disabled={pending} onClick={() => setStep("map")}>
                Back
              </button>
            )}
            <button type="button" className={primaryButtonClass} disabled={pending} onClick={commit}>
              {pending ? "Importing…" : "Import"}
            </button>
          </div>
        </>
      )}

      {step === "done" && data && result && (
        <div className={`${card} flex flex-col items-start gap-3 p-6`}>
          <p className="text-base font-semibold text-ink">
            Imported {result.imported} {result.imported === 1 ? "sample" : "samples"} from {result.files}{" "}
            {result.files === 1 ? "file" : "files"}.
          </p>
          {(result.skipped > 0 || result.replaced > 0) && (
            <p className="text-sm text-muted">
              {result.skipped} skipped{result.replaced > 0 ? ` · ${result.replaced} replaced` : ""}.
            </p>
          )}
          <div className="flex flex-wrap gap-2.5">
            <Link
              href={`/admin/quality?imports=${data.imports.map((i) => i.id).join(",")}`}
              className={`${primaryButtonClass} flex items-center`}
            >
              See the results
            </Link>
            <button type="button" className={secondaryButtonClass} onClick={restart}>
              Import more files
            </button>
          </div>
        </div>
      )}

      {newParamFor && (
        <NewParameterModal
          header={newParamFor.header}
          unit={newParamFor.unit}
          onClose={() => setNewParamFor(null)}
          onCreated={(p) => onParameterCreated(newParamFor.key, p)}
        />
      )}
    </div>
  );
}
