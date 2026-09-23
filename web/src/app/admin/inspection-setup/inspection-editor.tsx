"use client";

import { useState, useTransition } from "react";
import { Drawer } from "../drawer";
import { Switch } from "../switch";
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, XIcon } from "../icons";
import {
  cellInputClass,
  dangerLinkButtonClass,
  inputClass,
  labelClass,
  linkButtonClass,
  primaryButtonClass,
  secondaryButtonClass,
  sectionHeadingClass,
  smallPrimaryButtonClass,
  tableHeadCellClass,
} from "../ui";
import {
  INSPECTION_VALUE_TYPES,
  type Feedback,
  type GradingOption,
  type IncidentType,
  type InspectionDetail,
  type InspectionValueType,
} from "@/lib/inspection-setup/types";
import { saveInspection } from "./actions";
import { DropDownOptionModal, FeedbackModal } from "./editor-modals";
import { GradingDot } from "./grading-dot";

// Client-side draft of an Inspection and its child rows. Like the Mendix page,
// nothing is written until Save; Cancel discards everything.
type OptionDraft = {
  key: string;
  id: string | null;
  name: string;
  grading_id: string;
  nr_of_images_required: string;
  priority: number;
  active: boolean;
};

type RuleDraft = {
  key: string;
  id: string | null;
  lower_limit: string;
  upper_limit: string;
  nr_of_images_required: string;
  grading_id: string;
  feedback: Feedback | null;
};

type AllocationDraft = { key: string; id: string | null; asset_type_id: string };

type Draft = {
  id: string | null;
  name: string;
  description: string;
  value_type: InspectionValueType | "";
  is_required: boolean;
  active: boolean;
  nr_of_images_required: string;
  options: OptionDraft[];
  rules: RuleDraft[];
  allocations: AllocationDraft[];
};

function newKey() {
  return crypto.randomUUID();
}

function toDraft(detail: InspectionDetail | null): Draft {
  if (!detail) {
    // Attribute defaults: ValueType unset, IsRequired/Active true, 0 images.
    return {
      id: null,
      name: "",
      description: "",
      value_type: "",
      is_required: true,
      active: true,
      nr_of_images_required: "0",
      options: [],
      rules: [],
      allocations: [],
    };
  }
  const i = detail.inspection;
  return {
    id: i.id,
    name: i.name,
    description: i.description,
    value_type: i.value_type,
    is_required: i.is_required,
    active: i.active,
    nr_of_images_required: String(i.nr_of_images_required),
    options: detail.drop_down_options.map((o) => ({
      key: o.id,
      id: o.id,
      name: o.name,
      grading_id: o.grading_id,
      nr_of_images_required: String(o.nr_of_images_required),
      priority: o.priority,
      active: o.active,
    })),
    rules: detail.rules.map((r) => ({
      key: r.id,
      id: r.id,
      lower_limit: String(r.lower_limit),
      upper_limit: String(r.upper_limit),
      nr_of_images_required: String(r.nr_of_images_required),
      grading_id: r.grading_id ?? "",
      feedback: r.feedback,
    })),
    allocations: detail.allocations.map((a) => ({
      key: a.id,
      id: a.id,
      asset_type_id: a.asset_type_id,
    })),
  };
}

function isNonNegativeInt(v: string) {
  return /^\d+$/.test(v.trim());
}

function isNumber(v: string) {
  return v.trim() !== "" && Number.isFinite(Number(v));
}

type FieldErrors = Partial<Record<"name" | "value_type" | "nr_of_images_required", string>>;

export function InspectionEditor({
  detail,
  readOnly,
  gradings,
  assetTypes,
  incidentTypes,
  onClose,
}: {
  detail: InspectionDetail | null;
  readOnly: boolean;
  gradings: GradingOption[];
  assetTypes: { id: string; name: string; active: boolean }[];
  incidentTypes: IncidentType[];
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(detail));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [optionModal, setOptionModal] = useState<
    { mode: "add" } | { mode: "edit"; key: string } | null
  >(null);
  const [feedbackModal, setFeedbackModal] = useState<string | null>(null);
  const [allocationPick, setAllocationPick] = useState("");

  const gradingById = new Map(gradings.map((g) => [g.id, g]));
  const assetTypeById = new Map(assetTypes.map((a) => [a.id, a]));

  function patch(p: Partial<Draft>) {
    setDraft((d) => ({ ...d, ...p }));
  }

  // --------------------------------------------------------------------------
  // Drop-down options
  // --------------------------------------------------------------------------
  function patchOption(key: string, p: Partial<OptionDraft>) {
    setDraft((d) => ({
      ...d,
      options: d.options.map((o) => (o.key === key ? { ...o, ...p } : o)),
    }));
  }

  // Manual ordering: swap neighbours, then renumber priorities 1..n.
  function moveOption(key: string, delta: -1 | 1) {
    setDraft((d) => {
      const list = [...d.options];
      const i = list.findIndex((o) => o.key === key);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= list.length) return d;
      [list[i], list[j]] = [list[j], list[i]];
      return { ...d, options: list.map((o, n) => ({ ...o, priority: n + 1 })) };
    });
  }

  function saveOptionModal(values: { name: string; grading_id: string }) {
    if (optionModal?.mode === "edit") {
      patchOption(optionModal.key, values);
    } else {
      // IDO-R03: next sequential priority (max + 1, or 1 if none).
      setDraft((d) => ({
        ...d,
        options: [
          ...d.options,
          {
            key: newKey(),
            id: null,
            ...values,
            nr_of_images_required: "0",
            priority: Math.max(0, ...d.options.map((o) => o.priority)) + 1,
            active: true,
          },
        ],
      }));
    }
    setOptionModal(null);
  }

  // --------------------------------------------------------------------------
  // Rules
  // --------------------------------------------------------------------------
  function patchRule(key: string, p: Partial<RuleDraft>) {
    setDraft((d) => ({
      ...d,
      rules: d.rules.map((r) => (r.key === key ? { ...r, ...p } : r)),
    }));
  }

  // IRR-R02 (OCH_InspectionRule_Limits): a reversed range collapses to
  // [lower, lower] rather than being rejected. Applied when a limit is committed.
  function normaliseRule(key: string) {
    setDraft((d) => ({
      ...d,
      rules: d.rules.map((r) => {
        if (r.key !== key || !isNumber(r.lower_limit) || !isNumber(r.upper_limit)) return r;
        return Number(r.lower_limit) > Number(r.upper_limit)
          ? { ...r, upper_limit: r.lower_limit }
          : r;
      }),
    }));
  }

  // IRR-R03: a new rule starts as a zero-width range at the highest existing
  // upper limit (or 1 when there are no rules yet).
  function addRule() {
    setDraft((d) => {
      const uppers = d.rules.map((r) => Number(r.upper_limit)).filter(Number.isFinite);
      const start = String(uppers.length ? Math.max(...uppers) : 1);
      return {
        ...d,
        rules: [
          ...d.rules,
          {
            key: newKey(),
            id: null,
            lower_limit: start,
            upper_limit: start,
            nr_of_images_required: "0",
            grading_id: "",
            feedback: null,
          },
        ],
      };
    });
  }

  // IRR-R01: the rule with the lowest bound is the first rule.
  const firstRuleKey = [...draft.rules]
    .filter((r) => isNumber(r.lower_limit))
    .sort(
      (a, b) =>
        Number(a.lower_limit) - Number(b.lower_limit) ||
        Number(a.upper_limit) - Number(b.upper_limit),
    )[0]?.key;

  // --------------------------------------------------------------------------
  // Allocations
  // --------------------------------------------------------------------------
  const allocatedIds = new Set(draft.allocations.map((a) => a.asset_type_id));
  const allocatableAssetTypes = assetTypes.filter(
    (a) => a.active && !allocatedIds.has(a.id),
  );

  function addAllocation() {
    if (!allocationPick) return;
    setDraft((d) => ({
      ...d,
      allocations: [
        ...d.allocations,
        { key: newKey(), id: null, asset_type_id: allocationPick },
      ],
    }));
    setAllocationPick("");
  }

  // --------------------------------------------------------------------------
  // Save (ACT_Inspection_Save)
  // --------------------------------------------------------------------------
  function submit() {
    const errs: FieldErrors = {};
    // INS-R01 / INS-R02
    if (!draft.name.trim()) errs.name = "Required";
    if (!draft.value_type) errs.value_type = "Required";
    if (!isNonNegativeInt(draft.nr_of_images_required))
      errs.nr_of_images_required = "Must be a whole number, 0 or more";
    setFieldErrors(errs);
    setError(null);
    if (Object.keys(errs).length > 0) return;

    // INS-R03
    if (draft.value_type === "DROP_DOWN" && draft.options.length === 0) {
      setError("This Inspection requires Drop-Down Options.");
      return;
    }
    if (draft.value_type === "DROP_DOWN") {
      if (draft.options.some((o) => !isNonNegativeInt(o.nr_of_images_required))) {
        setError("Drop-down option image counts must be whole numbers, 0 or more.");
        return;
      }
    }
    if (draft.value_type === "DECIMAL_VALUE") {
      if (draft.rules.some((r) => !isNumber(r.lower_limit) || !isNumber(r.upper_limit))) {
        setError("Every rule needs a numeric lower and upper limit.");
        return;
      }
      if (draft.rules.some((r) => !isNonNegativeInt(r.nr_of_images_required))) {
        setError("Rule image counts must be whole numbers, 0 or more.");
        return;
      }
    }

    startTransition(async () => {
      const res = await saveInspection({
        id: draft.id,
        name: draft.name.trim(),
        description: draft.description,
        value_type: draft.value_type,
        is_required: draft.is_required,
        active: draft.active,
        nr_of_images_required: Number(draft.nr_of_images_required),
        drop_down_options: draft.options.map((o) => ({
          id: o.id,
          name: o.name,
          grading_id: o.grading_id,
          nr_of_images_required: Number(o.nr_of_images_required),
          priority: o.priority,
          active: o.active,
        })),
        rules: draft.rules.map((r) => ({
          id: r.id,
          lower_limit: Number(r.lower_limit),
          upper_limit: Number(r.upper_limit),
          nr_of_images_required: Number(r.nr_of_images_required),
          grading_id: r.grading_id || null,
          feedback: r.feedback,
        })),
        allocations: draft.allocations.map((a) => ({
          id: a.id,
          asset_type_id: a.asset_type_id,
        })),
      });
      if (res.error) setError(res.error);
      else onClose();
    });
  }

  const title = readOnly
    ? "View Inspection"
    : draft.id
      ? "Edit Inspection"
      : "New Inspection";

  const editingOption =
    optionModal?.mode === "edit"
      ? draft.options.find((o) => o.key === optionModal.key)
      : undefined;
  const editingFeedbackRule = feedbackModal
    ? draft.rules.find((r) => r.key === feedbackModal)
    : undefined;

  return (
    <Drawer
      open
      width={1120}
      title={title}
      onClose={onClose}
      footer={
        readOnly ? (
          <button onClick={onClose} className={secondaryButtonClass}>
            Close
          </button>
        ) : (
          <>
            <button disabled={isPending} onClick={onClose} className={secondaryButtonClass}>
              Cancel
            </button>
            <button disabled={isPending} onClick={submit} className={primaryButtonClass}>
              {isPending ? "Saving…" : "Save"}
            </button>
          </>
        )
      }
    >
      {error && (
        <p className="mb-4 border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[300px_1fr]">
        {/* Left column — the Inspection's own attributes */}
        <div className="flex flex-col gap-4">
          <FormRow label="Name" error={fieldErrors.name}>
            <input
              className={inputClass}
              value={draft.name}
              disabled={readOnly}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </FormRow>
          <FormRow label="Description">
            <textarea
              className={`${inputClass} h-auto py-2`}
              rows={3}
              value={draft.description}
              disabled={readOnly}
              onChange={(e) => patch({ description: e.target.value })}
            />
          </FormRow>
          <FormRow label="Value type" error={fieldErrors.value_type}>
            <select
              className={inputClass}
              value={draft.value_type}
              disabled={readOnly}
              onChange={(e) =>
                patch({ value_type: e.target.value as InspectionValueType | "" })
              }
            >
              <option value="">Select…</option>
              {INSPECTION_VALUE_TYPES.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </FormRow>
          <FormRow label="Nr of images required" error={fieldErrors.nr_of_images_required}>
            <input
              className={inputClass}
              type="number"
              min={0}
              step={1}
              value={draft.nr_of_images_required}
              disabled={readOnly}
              onChange={(e) => patch({ nr_of_images_required: e.target.value })}
            />
          </FormRow>
          <div className="flex flex-col gap-3 pt-1">
            <Switch
              label="Required"
              checked={draft.is_required}
              disabled={readOnly}
              onChange={(v) => patch({ is_required: v })}
            />
            <Switch
              label="Active"
              checked={draft.active}
              disabled={readOnly}
              onChange={(v) => patch({ active: v })}
            />
          </div>
        </div>

        {/* Right column — child configuration */}
        <div className="flex min-w-0 flex-col gap-6">
          {/* Asset Type Allocation — always visible */}
          <Section
            title="Asset type allocation"
            actions={
              !readOnly && (
                <div className="flex items-center gap-2">
                  <select
                    aria-label="Asset type to allocate"
                    className={`${cellInputClass} w-52`}
                    value={allocationPick}
                    onChange={(e) => setAllocationPick(e.target.value)}
                  >
                    <option value="">Select asset type…</option>
                    {allocatableAssetTypes.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={!allocationPick}
                    onClick={addAllocation}
                    className={smallPrimaryButtonClass}
                  >
                    <PlusIcon className="h-3.5 w-3.5" />
                    Add
                  </button>
                </div>
              )
            }
          >
            {draft.allocations.length === 0 ? (
              <Empty>Not allocated to any asset type yet.</Empty>
            ) : (
              <ul className="flex flex-wrap gap-2 p-3">
                {draft.allocations.map((a) => {
                  const at = assetTypeById.get(a.asset_type_id);
                  return (
                    <li
                      key={a.key}
                      className="flex h-[30px] items-center gap-1.5 rounded-full border border-border bg-table-head pr-1.5 pl-3 text-[13px] text-ink"
                    >
                      {at?.name ?? "Unknown asset type"}
                      {at && !at.active && (
                        <span className="text-[11px] text-muted">(inactive)</span>
                      )}
                      {!readOnly && (
                        <button
                          aria-label={`Remove ${at?.name ?? "allocation"}`}
                          onClick={() =>
                            patch({
                              allocations: draft.allocations.filter((x) => x.key !== a.key),
                            })
                          }
                          className="rounded-full p-1 text-muted transition-colors hover:bg-black/[.06] hover:text-danger"
                        >
                          <XIcon className="h-3 w-3" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          {/* Drop Down Options — only for DROP_DOWN */}
          {draft.value_type === "DROP_DOWN" && (
            <Section
              title="Drop-down options"
              actions={
                !readOnly && (
                  <button
                    onClick={() => setOptionModal({ mode: "add" })}
                    className={smallPrimaryButtonClass}
                  >
                    <PlusIcon className="h-3.5 w-3.5" />
                    Add
                  </button>
                )
              }
            >
              {draft.options.length === 0 ? (
                <Empty>No options yet — a drop-down inspection needs at least one.</Empty>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-table-head">
                      <th className={`${tableHeadCellClass} w-20`}>Order</th>
                      <th className={tableHeadCellClass}>Name</th>
                      <th className={`${tableHeadCellClass} w-28`}>Images</th>
                      <th className={tableHeadCellClass}>Grading</th>
                      {!readOnly && <th className={`${tableHeadCellClass} w-28`} />}
                    </tr>
                  </thead>
                  <tbody>
                    {draft.options.map((o, i) => (
                      <tr key={o.key} className="h-[46px] border-t border-border">
                        <td className="px-3">
                          <div className="flex items-center gap-1">
                            <span className="w-5 font-mono text-[13px] text-muted">
                              {o.priority}
                            </span>
                            {!readOnly && (
                              <>
                                <IconButton
                                  label="Move up"
                                  disabled={i === 0}
                                  onClick={() => moveOption(o.key, -1)}
                                >
                                  <ArrowUpIcon className="h-3.5 w-3.5" />
                                </IconButton>
                                <IconButton
                                  label="Move down"
                                  disabled={i === draft.options.length - 1}
                                  onClick={() => moveOption(o.key, 1)}
                                >
                                  <ArrowDownIcon className="h-3.5 w-3.5" />
                                </IconButton>
                              </>
                            )}
                          </div>
                        </td>
                        <td className="px-3 text-ink">{o.name}</td>
                        <td className="px-3">
                          <input
                            aria-label={`Images required for ${o.name}`}
                            className={cellInputClass}
                            type="number"
                            min={0}
                            step={1}
                            value={o.nr_of_images_required}
                            disabled={readOnly}
                            onChange={(e) =>
                              patchOption(o.key, { nr_of_images_required: e.target.value })
                            }
                          />
                        </td>
                        <td className="px-3">
                          <GradingSelect
                            gradings={gradings}
                            value={o.grading_id}
                            disabled={readOnly}
                            onChange={(v) => patchOption(o.key, { grading_id: v })}
                            label={`Grading for ${o.name}`}
                          />
                        </td>
                        {!readOnly && (
                          <td className="px-3 whitespace-nowrap">
                            <div className="flex gap-3">
                              <button
                                onClick={() => setOptionModal({ mode: "edit", key: o.key })}
                                className={linkButtonClass}
                              >
                                Edit
                              </button>
                              <button
                                onClick={() =>
                                  patch({
                                    options: draft.options
                                      .filter((x) => x.key !== o.key)
                                      .map((x, n) => ({ ...x, priority: n + 1 })),
                                  })
                                }
                                className={dangerLinkButtonClass}
                              >
                                Remove
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>
          )}

          {/* Rules — only for DECIMAL_VALUE */}
          {draft.value_type === "DECIMAL_VALUE" && (
            <Section
              title="Rules"
              actions={
                !readOnly && (
                  <button onClick={addRule} className={smallPrimaryButtonClass}>
                    <PlusIcon className="h-3.5 w-3.5" />
                    Add
                  </button>
                )
              }
            >
              {draft.rules.length === 0 ? (
                <Empty>No rules yet.</Empty>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-table-head">
                      <th className={`${tableHeadCellClass} w-32`}>Lower limit</th>
                      <th className={`${tableHeadCellClass} w-28`}>Upper limit</th>
                      <th className={`${tableHeadCellClass} w-24`}>Images</th>
                      <th className={tableHeadCellClass}>Grading</th>
                      <th className={tableHeadCellClass}>Feedback</th>
                      {!readOnly && <th className={`${tableHeadCellClass} w-20`} />}
                    </tr>
                  </thead>
                  <tbody>
                    {draft.rules.map((r) => (
                      <tr key={r.key} className="h-[46px] border-t border-border align-middle">
                        <td className="px-3">
                          <div className="flex items-center gap-1.5">
                            <input
                              aria-label="Lower limit"
                              className={cellInputClass}
                              type="number"
                              step="any"
                              value={r.lower_limit}
                              disabled={readOnly}
                              onChange={(e) => patchRule(r.key, { lower_limit: e.target.value })}
                              onBlur={() => normaliseRule(r.key)}
                            />
                            {r.key === firstRuleKey && (
                              <span
                                title="Lowest range — the first rule"
                                className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary"
                              >
                                1st
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3">
                          <input
                            aria-label="Upper limit"
                            className={cellInputClass}
                            type="number"
                            step="any"
                            value={r.upper_limit}
                            disabled={readOnly}
                            onChange={(e) => patchRule(r.key, { upper_limit: e.target.value })}
                            onBlur={() => normaliseRule(r.key)}
                          />
                        </td>
                        <td className="px-3">
                          <input
                            aria-label="Images required"
                            className={cellInputClass}
                            type="number"
                            min={0}
                            step={1}
                            value={r.nr_of_images_required}
                            disabled={readOnly}
                            onChange={(e) =>
                              patchRule(r.key, { nr_of_images_required: e.target.value })
                            }
                          />
                        </td>
                        <td className="px-3">
                          <GradingSelect
                            gradings={gradings}
                            value={r.grading_id}
                            disabled={readOnly}
                            allowEmpty
                            onChange={(v) => patchRule(r.key, { grading_id: v })}
                            label="Grading"
                          />
                        </td>
                        <td className="max-w-[220px] px-3">
                          {r.feedback ? (
                            <button
                              onClick={() => setFeedbackModal(r.key)}
                              className="block w-full truncate text-left text-[13px] text-ink hover:text-primary"
                              title={r.feedback.feedback}
                            >
                              {r.feedback.auto_create_incident && (
                                <span className="mr-1.5 rounded-full bg-warning-bg px-1.5 py-0.5 text-[10px] font-semibold text-warning">
                                  Incident
                                </span>
                              )}
                              {r.feedback.feedback}
                            </button>
                          ) : readOnly ? (
                            <span className="text-muted">—</span>
                          ) : (
                            <button
                              onClick={() => setFeedbackModal(r.key)}
                              className={linkButtonClass}
                            >
                              + Add feedback
                            </button>
                          )}
                        </td>
                        {!readOnly && (
                          <td className="px-3">
                            <button
                              onClick={() =>
                                patch({ rules: draft.rules.filter((x) => x.key !== r.key) })
                              }
                              className={dangerLinkButtonClass}
                            >
                              Remove
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Section>
          )}

          {draft.value_type &&
            draft.value_type !== "DROP_DOWN" &&
            draft.value_type !== "DECIMAL_VALUE" && (
              <p className="text-[13px] text-muted">
                {draft.value_type} inspections have no options or rules — the answer is
                entered directly when the inspection is performed.
              </p>
            )}
          {draft.value_type === "DECIMAL_VALUE" && draft.rules.length > 0 && (
            <MissingGradingHint gradings={gradings} used={draft.rules.map((r) => r.grading_id)} />
          )}
        </div>
      </div>

      {optionModal && (
        <DropDownOptionModal
          initial={editingOption ?? null}
          gradings={gradings}
          onCancel={() => setOptionModal(null)}
          onSave={saveOptionModal}
        />
      )}

      {editingFeedbackRule && (
        <FeedbackModal
          initial={editingFeedbackRule.feedback}
          readOnly={readOnly}
          incidentTypes={incidentTypes}
          onCancel={() => setFeedbackModal(null)}
          onSave={(fb) => {
            patchRule(editingFeedbackRule.key, { feedback: fb });
            setFeedbackModal(null);
          }}
          onRemove={() => {
            patchRule(editingFeedbackRule.key, { feedback: null });
            setFeedbackModal(null);
          }}
        />
      )}
      {gradingById.size === 0 && !readOnly && (
        <p className="mt-6 text-[13px] text-warning">
          No gradings exist yet — add them under Master Data → Grading before configuring
          options or rules.
        </p>
      )}
    </Drawer>
  );
}

function FormRow({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className={labelClass}>{label}</label>
      {children}
      {error && <span className="text-xs text-danger">{error}</span>}
    </div>
  );
}

function Section({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-card border border-border">
      <div className="flex min-h-[52px] items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <h3 className={sectionHeadingClass}>{title}</h3>
        {actions}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-6 text-center text-[13px] text-muted">{children}</p>;
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded-control p-1 text-muted transition-colors hover:bg-black/[.05] hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

function GradingSelect({
  gradings,
  value,
  onChange,
  disabled,
  allowEmpty,
  label,
}: {
  gradings: GradingOption[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  allowEmpty?: boolean;
  label: string;
}) {
  const selected = gradings.find((g) => g.id === value);
  return (
    <div className="flex items-center gap-2">
      <GradingDot colour={selected?.hex_colour ?? null} />
      <select
        aria-label={label}
        className={cellInputClass}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{allowEmpty ? "— None —" : "Select…"}</option>
        {gradings.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function MissingGradingHint({
  gradings,
  used,
}: {
  gradings: GradingOption[];
  used: string[];
}) {
  const missing = used.filter((g) => !g).length;
  if (missing === 0) return null;
  return (
    <p className="text-[13px] text-muted">
      {missing === 1 ? "1 rule has" : `${missing} rules have`} no grading
      {gradings.length > 0 ? " — pick one so the range resolves to a result." : "."}
    </p>
  );
}
