"use client";

import { useState } from "react";
import { Modal } from "../modal";
import { Switch } from "../switch";
import {
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../ui";
import type { Feedback, GradingOption, IncidentType } from "@/lib/inspection-setup/types";
import { GradingDot } from "./grading-dot";

function FieldError({ message }: { message?: string }) {
  return message ? <span className="text-xs text-danger">{message}</span> : null;
}

// InspectionDropDownOption_NewEdit — just Name and Grading; image count,
// priority and active are edited inline in the parent grid.
export function DropDownOptionModal({
  initial,
  gradings,
  onCancel,
  onSave,
}: {
  initial: { name: string; grading_id: string } | null;
  gradings: GradingOption[];
  onCancel: () => void;
  onSave: (values: { name: string; grading_id: string }) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [gradingId, setGradingId] = useState(initial?.grading_id ?? "");
  const [errors, setErrors] = useState<{ name?: string; grading?: string }>({});
  const selected = gradings.find((g) => g.id === gradingId);

  function save() {
    // IDO-R01 / IDO-R02
    const errs = {
      name: name.trim() ? undefined : "Required",
      grading: gradingId ? undefined : "Required",
    };
    setErrors(errs);
    if (errs.name || errs.grading) return;
    onSave({ name: name.trim(), grading_id: gradingId });
  }

  return (
    <Modal
      open
      title={initial ? "Edit Drop Down Option" : "New Drop Down Option"}
      onClose={onCancel}
      footer={
        <>
          <button onClick={onCancel} className={secondaryButtonClass}>
            Cancel
          </button>
          <button onClick={save} className={primaryButtonClass}>
            Save
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className={labelClass}>Name</label>
          <input
            autoFocus
            className={inputClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <FieldError message={errors.name} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={labelClass}>Grading</label>
          <div className="flex items-center gap-2.5">
            <GradingDot colour={selected?.hex_colour ?? null} />
            <select
              className={inputClass}
              value={gradingId}
              onChange={(e) => setGradingId(e.target.value)}
            >
              <option value="">Select…</option>
              {gradings.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <FieldError message={errors.grading} />
        </div>
      </div>
    </Modal>
  );
}

// InspectionRule_Feedback ("User Feedback") — edits the in-memory Feedback of
// one rule; persisted with the rest of the inspection on Save.
export function FeedbackModal({
  initial,
  readOnly,
  incidentTypes,
  onCancel,
  onSave,
  onRemove,
}: {
  initial: Feedback | null;
  readOnly: boolean;
  incidentTypes: IncidentType[];
  onCancel: () => void;
  onSave: (feedback: Feedback) => void;
  onRemove: () => void;
}) {
  const [text, setText] = useState(initial?.feedback ?? "");
  // ACT_InspectionRule_AddFeedback seeds MaxNrOfRetries = 1.
  const [retries, setRetries] = useState(String(initial?.max_nr_of_retries ?? 1));
  const [autoCreate, setAutoCreate] = useState(initial?.auto_create_incident ?? false);
  const [incidentTypeId, setIncidentTypeId] = useState(initial?.incident_type_id ?? "");
  const [errors, setErrors] = useState<{
    text?: string;
    retries?: string;
    incidentType?: string;
  }>({});

  // Only active types are offered (the page's `[Active]` filter); a currently
  // selected inactive type is kept visible so it isn't silently dropped.
  const typeOptions = incidentTypes
    .filter((t) => t.active || t.id === incidentTypeId)
    .sort((a, b) => a.name.localeCompare(b.name));

  function save() {
    const errs = {
      // FBK-R01
      text: text.length >= 5 ? undefined : "Must be at least 5 characters.",
      // FBK-R02
      retries: /^\d+$/.test(retries.trim()) && Number(retries) >= 1 ? undefined : "Must be >= 1",
      // FBK-R03
      incidentType: autoCreate && !incidentTypeId ? "Required" : undefined,
    };
    setErrors(errs);
    if (errs.text || errs.retries || errs.incidentType) return;
    onSave({
      feedback: text,
      max_nr_of_retries: Number(retries),
      auto_create_incident: autoCreate,
      incident_type_id: autoCreate ? incidentTypeId : null,
    });
  }

  return (
    <Modal
      open
      title="User Feedback"
      onClose={onCancel}
      footer={
        readOnly ? (
          <button onClick={onCancel} className={secondaryButtonClass}>
            Close
          </button>
        ) : (
          <>
            {initial && (
              <button
                onClick={onRemove}
                className="mr-auto h-[40px] rounded-control px-3 text-sm font-semibold text-danger transition-colors hover:bg-danger-bg"
              >
                Remove user feedback
              </button>
            )}
            <button onClick={onCancel} className={secondaryButtonClass}>
              Cancel
            </button>
            <button onClick={save} className={primaryButtonClass}>
              Save
            </button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className={labelClass}>Feedback</label>
          <textarea
            autoFocus={!readOnly}
            rows={5}
            className={`${inputClass} h-auto py-2`}
            value={text}
            disabled={readOnly}
            onChange={(e) => setText(e.target.value)}
          />
          <FieldError message={errors.text} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={labelClass}>Max nr of retries</label>
          <input
            type="number"
            min={1}
            step={1}
            className={inputClass}
            value={retries}
            disabled={readOnly}
            onChange={(e) => setRetries(e.target.value)}
          />
          <FieldError message={errors.retries} />
        </div>
        <Switch
          label="Auto create incident"
          checked={autoCreate}
          disabled={readOnly}
          onChange={(v) => {
            setAutoCreate(v);
            // FBK-R04 (OCH_Feedback_ClearIncidentType): every toggle clears
            // the selected incident type.
            setIncidentTypeId("");
          }}
        />
        {autoCreate && (
          <div className="flex flex-col gap-3 rounded-control bg-table-head p-3">
            <p className="text-[13px] text-muted">
              If the number of retries exceeds the maximum then an incident will be logged
              for the selected Incident Type.
            </p>
            <div className="flex flex-col gap-1.5">
              <label className={labelClass}>Incident type</label>
              <select
                className={inputClass}
                value={incidentTypeId}
                disabled={readOnly}
                onChange={(e) => setIncidentTypeId(e.target.value)}
              >
                <option value="">Select…</option>
                {typeOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.active ? "" : " (inactive)"}
                  </option>
                ))}
              </select>
              <FieldError message={errors.incidentType} />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
