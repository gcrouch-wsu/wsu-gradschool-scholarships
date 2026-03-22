"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RichTextEditor } from "./RichTextEditor";

interface Column {
  id: number;
  title: string;
  type: string;
  options?: string[];
}

interface IntakeField {
  id?: string;
  field_key: string;
  label: string;
  help_text: string | null;
  field_type: string;
  required: boolean;
  target_column_id: number | null;
  target_column_title: string | null;
  target_column_type: string | null;
  settings_json: Record<string, unknown>;
}

interface IntakeSubmissionSummary {
  submission_id: string;
  submitter_email: string | null;
  status: string;
  smartsheet_row_id: number | null;
  created_at: string;
  is_resolved: boolean;
}

interface IntakeForm {
  id: string;
  title: string;
  instructions_text: string | null;
  status: string;
  opens_at: string | null;
  closes_at: string | null;
  published_version_id: string | null;
}

type DesktopLayoutMode = "full" | "left" | "right";

const FIELD_TYPES = [
  { value: "short_text", label: "Short Text" },
  { value: "long_text", label: "Long Text (Narrative)" },
  { value: "email", label: "Email" },
  { value: "number", label: "Number" },
  { value: "select", label: "Dropdown Select" },
  { value: "checkbox", label: "Checkbox (Yes/No)" },
  { value: "date", label: "Date" },
  { value: "file", label: "File Upload (PDF)" },
];

const CUSTOM_ADDABLE_FIELD_TYPES = FIELD_TYPES.filter((type) => type.value === "file");
const DESKTOP_LAYOUT_OPTIONS: Array<{
  value: DesktopLayoutMode;
  label: string;
  description: string;
}> = [
  { value: "full", label: "Full width", description: "Spans the full form width on desktop" },
  { value: "left", label: "Left column", description: "Pins this field to the left desktop column" },
  { value: "right", label: "Right column", description: "Pins this field to the right desktop column" },
];

const ALLOWED_SMARTSHEET_TYPES = ["TEXT_NUMBER", "PICKLIST", "DATE", "CHECKBOX"];

function slugifyFieldKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

function createUniqueFieldKey(baseValue: string, existingFields: IntakeField[]): string {
  const base = slugifyFieldKey(baseValue) || "field";
  const existingKeys = new Set(existingFields.map((field) => field.field_key));
  if (!existingKeys.has(base)) return base;

  let counter = 2;
  while (existingKeys.has(`${base}_${counter}`)) {
    counter += 1;
  }
  return `${base}_${counter}`;
}

function inferFieldTypeFromColumn(column: Column): string {
  if (column.type === "PICKLIST") return "select";
  if (column.type === "DATE") return "date";
  if (column.type === "CHECKBOX") return "checkbox";
  return "short_text";
}

function getDefaultSettingsForFieldType(type: string, column?: Column | null): Record<string, unknown> {
  if (type === "select") {
    return { options: [...(column?.options ?? [])] };
  }
  if (type === "file") {
    return { multiple: false };
  }
  return {};
}

function getSelectOptions(field: IntakeField): string[] {
  const options = field.settings_json?.options;
  if (!Array.isArray(options)) return [];
  return options.filter((option): option is string => typeof option === "string" && option.trim() !== "");
}

function getDesktopLayoutMode(field: IntakeField): DesktopLayoutMode {
  const mode = field.settings_json?.layout_mode;
  return mode === "left" || mode === "right" || mode === "full" ? mode : "full";
}

function AccordionCard({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-lg border border-zinc-200 bg-white overflow-hidden"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 font-bold text-zinc-900 hover:bg-zinc-50 [&::-webkit-details-marker]:hidden">
        <span className="text-zinc-400 transition-transform group-open:rotate-90" aria-hidden>
          ▶
        </span>
        {title}
      </summary>
      <div className="border-t border-zinc-200 px-4 pb-4 pt-3">{children}</div>
    </details>
  );
}

export default function IntakeFormBuilder({
  programId,
  cycleId,
}: {
  programId: string;
  cycleId: string;
}) {
  const router = useRouter();
  const [form, setForm] = useState<IntakeForm | null>(null);
  const [fields, setFields] = useState<IntakeField[]>([]);
  const [columns, setColumns] = useState<Column[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submissions, setSubmissions] = useState<IntakeSubmissionSummary[]>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const [selectedColumnId, setSelectedColumnId] = useState("");

  useEffect(() => {
    async function load() {
      try {
        // First ensure form exists
        const initRes = await fetch(`/api/admin/cycles/${cycleId}/intake-form`, { method: "POST" });
        if (!initRes.ok) throw new Error("Failed to initialize intake form");

        const [dataRes, cycleRes] = await Promise.all([
          fetch(`/api/admin/cycles/${cycleId}/intake-form`),
          fetch(`/api/admin/cycles/${cycleId}/builder`) // Reusing builder API for columns
        ]);

        const data = await dataRes.json();
        const cycleData = await cycleRes.json();

        setForm(data.form);
        setFields(data.fields || []);
        setColumns(cycleData.columns || []);
        
        loadSubmissions();
      } catch (err) {
        setError("Failed to load intake form data");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [cycleId]);

  const loadSubmissions = async () => {
    setLoadingSubmissions(true);
    try {
      const res = await fetch(`/api/admin/cycles/${cycleId}/intake-form/submissions`);
      const data = await res.json();
      setSubmissions(data.submissions || []);
    } catch (err) {
      console.error("Failed to load submissions");
    } finally {
      setLoadingSubmissions(false);
    }
  };

  const addField = (type: string, overrides: Partial<IntakeField> = {}) => {
    const key = overrides.field_key || createUniqueFieldKey(overrides.label || `field_${Date.now()}`, fields);
    const newField: IntakeField = {
      id: overrides.id,
      field_key: key,
      label: overrides.label || "New Field",
      help_text: overrides.help_text ?? "",
      field_type: type,
      required: overrides.required ?? false,
      target_column_id: overrides.target_column_id ?? null,
      target_column_title: overrides.target_column_title ?? null,
      target_column_type: overrides.target_column_type ?? null,
      settings_json: overrides.settings_json ?? getDefaultSettingsForFieldType(type)
    };
    setFields([...fields, newField]);
  };

  const addFieldFromSelectedColumn = () => {
    const column = columns.find((candidate) => String(candidate.id) === selectedColumnId);
    if (!column) return;

    const fieldType = inferFieldTypeFromColumn(column);
    addField(fieldType, {
      label: column.title,
      field_key: createUniqueFieldKey(column.title, fields),
      target_column_id: column.id,
      target_column_title: column.title,
      target_column_type: column.type,
      settings_json: getDefaultSettingsForFieldType(fieldType, column),
    });
    setSelectedColumnId("");
  };

  const removeField = (index: number) => {
    setFields(fields.filter((_, i) => i !== index));
  };

  const updateField = (index: number, updates: Partial<IntakeField>) => {
    const next = [...fields];
    next[index] = { ...next[index], ...updates };
    setFields(next);
  };

  const updateFieldLayout = (index: number, layoutMode: DesktopLayoutMode) => {
    const field = fields[index];
    if (!field) return;
    updateField(index, {
      settings_json: {
        ...field.settings_json,
        layout_mode: layoutMode,
      },
    });
  };

  const moveFieldToLayout = (fieldKey: string, layoutMode: DesktopLayoutMode) => {
    setFields((current) =>
      current.map((field) =>
        field.field_key === fieldKey
          ? {
              ...field,
              settings_json: {
                ...field.settings_json,
                layout_mode: layoutMode,
              },
            }
          : field
      )
    );
  };

  const handleSave = async () => {
    setError("");
    setSuccess("");
    setSaving(true);
    try {
      // Save form settings
      const formRes = await fetch(`/api/admin/cycles/${cycleId}/intake-form`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      if (!formRes.ok) throw new Error("Failed to save form settings");

      // Save fields
      const fieldsRes = await fetch(`/api/admin/cycles/${cycleId}/intake-form/fields`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields })
      });
      if (!fieldsRes.ok) {
        const d = await fieldsRes.json();
        throw new Error(d.error || "Failed to save fields");
      }

      setSuccess("Configuration saved successfully");
      router.refresh();
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handlePublish = async () => {
    if (!confirm("Are you sure you want to publish this form? This will create a new public version.")) return;
    setError("");
    setSuccess("");
    setPublishing(true);
    try {
      // Must save first
      const saved = await handleSave();
      if (!saved) {
        return;
      }
      
      const res = await fetch(`/api/admin/cycles/${cycleId}/intake-form/publish`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Failed to publish");
      }
      setSuccess("Form published successfully");
      // Reload to get new status
      const dataRes = await fetch(`/api/admin/cycles/${cycleId}/intake-form`);
      const data = await dataRes.json();
      setForm(data.form);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPublishing(false);
    }
  };

  const handleUnpublish = async () => {
    if (!confirm("Unpublish this form? It will no longer be available to the public.")) return;
    setError("");
    setSuccess("");
    try {
      const res = await fetch(`/api/admin/cycles/${cycleId}/intake-form/unpublish`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to unpublish");
      setSuccess("Form unpublished");
      const dataRes = await fetch(`/api/admin/cycles/${cycleId}/intake-form`);
      const data = await dataRes.json();
      setForm(data.form);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleRetry = async (submissionId: string) => {
    if (!confirm("Retry processing this submission?")) return;
    try {
      const res = await fetch(`/api/admin/cycles/${cycleId}/intake-form/submissions/${submissionId}/retry`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Retry failed");
      }
      setSuccess("Retry initiated successfully");
      loadSubmissions();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteSubmission = async (submissionId: string) => {
    if (!confirm("Are you sure you want to delete this submission record? This will not affect Smartsheet.")) return;
    try {
      const res = await fetch(`/api/admin/cycles/${cycleId}/intake-form/submissions/${submissionId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      setSuccess("Submission record deleted");
      loadSubmissions();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleResolve = async (submissionId: string) => {
    try {
      const res = await fetch(`/api/admin/cycles/${cycleId}/intake-form/submissions/${submissionId}/resolve`, { method: "POST" });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Resolve failed");
      }
      setSuccess("Submission marked resolved");
      loadSubmissions();
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (loading || !form) return <div className="mt-6 text-zinc-500">Loading builder...</div>;

  const availableColumns = columns.filter(
    (column) =>
      ALLOWED_SMARTSHEET_TYPES.includes(column.type) &&
      !fields.some((field) => field.target_column_id === column.id)
  );

  return (
    <div className="mt-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-zinc-900">Intake Form Builder</h1>
        <div className="flex gap-2">
          {form.status === "published" ? (
            <button
              onClick={handleUnpublish}
              className="rounded border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
            >
              Unpublish
            </button>
          ) : null}
          <button
            onClick={handleSave}
            disabled={saving || publishing}
            className="rounded border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            {saving ? "Saving..." : "Save Draft"}
          </button>
          <button
            onClick={handlePublish}
            disabled={saving || publishing}
            className="rounded bg-[var(--wsu-crimson)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--wsu-crimson-hover)]"
          >
            {publishing ? "Publishing..." : "Publish Form"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {success}
        </div>
      )}
      {form.published_version_id && (
        <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          The live public form uses the last published version. Draft edits you save here stay private until you click <strong>Publish Form</strong> again.
        </div>
      )}

      <AccordionCard title="Form Settings" defaultOpen={form.status === "draft"}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-zinc-700">Form Title</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
            />
          </div>
          <div className="sm:col-span-2">
            <RichTextEditor
              label="Instructions"
              value={form.instructions_text}
              onChange={(instructionsText) => setForm({ ...form, instructions_text: instructionsText })}
              hint="Use links, bullets, and emphasis for download instructions or nomination guidance."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700">Opens At</label>
            <input
              type="datetime-local"
              value={form.opens_at ? new Date(form.opens_at).toISOString().slice(0, 16) : ""}
              onChange={(e) => setForm({ ...form, opens_at: e.target.value || null })}
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-zinc-700">Closes At</label>
            <input
              type="datetime-local"
              value={form.closes_at ? new Date(form.closes_at).toISOString().slice(0, 16) : ""}
              onChange={(e) => setForm({ ...form, closes_at: e.target.value || null })}
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
            />
          </div>
        </div>
      </AccordionCard>

      <AccordionCard title="Fields" defaultOpen>
        <div className="space-y-4">
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <h3 className="text-sm font-semibold text-zinc-900">Add questions</h3>
            <p className="mt-1 text-sm text-zinc-600">
              Recommended: start from a synced Smartsheet column so the question matches the destination data type.
            </p>
            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                <h4 className="text-sm font-medium text-zinc-900">From synced Smartsheet column</h4>
                <p className="mt-1 text-xs text-zinc-500">
                  This pre-fills the label, maps the column, and chooses a sensible default field type.
                </p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <select
                    value={selectedColumnId}
                    onChange={(e) => setSelectedColumnId(e.target.value)}
                    className="min-w-0 flex-1 rounded border border-zinc-300 px-3 py-2 text-sm"
                  >
                    <option value="">Select a Smartsheet column...</option>
                    {availableColumns.map((column) => (
                      <option key={column.id} value={column.id}>
                        {column.title} ({column.type})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={addFieldFromSelectedColumn}
                    disabled={!selectedColumnId}
                    className="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Add mapped question
                  </button>
                </div>
                {availableColumns.length === 0 && (
                  <p className="mt-2 text-xs text-zinc-500">
                    All supported columns are already mapped, or the cycle needs a fresh Smartsheet sync.
                  </p>
                )}
              </div>
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                <h4 className="text-sm font-medium text-zinc-900">App-managed uploads</h4>
                <p className="mt-1 text-xs text-zinc-500">
                  Smartsheet remains the source of truth for non-file data, so every non-file question should start from a synced column. Use this area only for PDF upload prompts.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {CUSTOM_ADDABLE_FIELD_TYPES.map(type => (
                    <button
                      key={type.value}
                      type="button"
                      onClick={() => addField(type.value)}
                      className="rounded border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                    >
                      Add {type.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {fields.length > 0 && (
            <div className="rounded-lg border border-zinc-200 bg-white p-4">
              <h3 className="text-sm font-semibold text-zinc-900">Desktop layout</h3>
              <p className="mt-1 text-sm text-zinc-600">
                Drag question chips between lanes to place them left, right, or full width on desktop. Mobile still stacks everything in one column.
              </p>
              <div className="mt-4 grid gap-3 lg:grid-cols-3">
                {DESKTOP_LAYOUT_OPTIONS.map((option) => {
                  const laneFields = fields.filter((field) => getDesktopLayoutMode(field) === option.value);
                  return (
                    <div
                      key={option.value}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const fieldKey = e.dataTransfer.getData("text/plain");
                        if (fieldKey) moveFieldToLayout(fieldKey, option.value);
                      }}
                      className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-3"
                    >
                      <h4 className="text-sm font-medium text-zinc-900">{option.label}</h4>
                      <p className="mt-1 text-xs text-zinc-500">{option.description}</p>
                      <div className="mt-3 flex min-h-16 flex-wrap gap-2">
                        {laneFields.length > 0 ? laneFields.map((field) => (
                          <button
                            key={field.field_key}
                            type="button"
                            draggable
                            onDragStart={(e) => e.dataTransfer.setData("text/plain", field.field_key)}
                            className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-700 shadow-sm"
                          >
                            {field.label}
                          </button>
                        )) : (
                          <span className="text-xs text-zinc-400">Drop questions here</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {fields.map((field, idx) => (
            <div key={field.id || field.field_key || idx} className="relative rounded-lg border border-zinc-200 bg-zinc-50 p-4">
              <div className="mb-4 flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", String(idx));
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      const fromIdx = parseInt(e.dataTransfer.getData("text/plain"), 10);
                      if (fromIdx === idx) return;
                      const next = [...fields];
                      const [moved] = next.splice(fromIdx, 1);
                      next.splice(idx, 0, moved);
                      setFields(next);
                    }}
                    className="cursor-grab text-zinc-400 hover:text-zinc-600"
                  >
                    ⠿
                  </div>
                  <span className="rounded bg-zinc-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-zinc-600">
                    {FIELD_TYPES.find(t => t.value === field.field_type)?.label}
                  </span>
                </div>
                <button
                  onClick={() => removeField(idx)}
                  className="text-xs text-red-600 hover:underline"
                >
                  Remove
                </button>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-[11px] font-bold uppercase text-zinc-500">Field Label</label>
                  <input
                    type="text"
                    value={field.label}
                    onChange={(e) => updateField(idx, { label: e.target.value })}
                    className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase text-zinc-500">Internal Key (must be unique)</label>
                  <input
                    type="text"
                    value={field.field_key}
                    onChange={(e) => updateField(idx, { field_key: e.target.value.replace(/[^a-zA-Z0-9_]/g, "") })}
                    className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm font-mono"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-bold uppercase text-zinc-500">Help Text / Instructions</label>
                  <input
                    type="text"
                    value={field.help_text || ""}
                    onChange={(e) => updateField(idx, { help_text: e.target.value })}
                    className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase text-zinc-500">Desktop Layout</label>
                  <select
                    value={getDesktopLayoutMode(field)}
                    onChange={(e) => updateFieldLayout(idx, e.target.value as DesktopLayoutMode)}
                    className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                  >
                    {DESKTOP_LAYOUT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[10px] text-zinc-500">Mobile always stacks this field in one column.</p>
                </div>

                {field.field_type !== "file" && (
                  <>
                    <div>
                      <label className="block text-[11px] font-bold uppercase text-zinc-500">Target Smartsheet Column</label>
                      <select
                        value={field.target_column_id || ""}
                        onChange={(e) => {
                          const col = columns.find(c => String(c.id) === e.target.value);
                          const nextType = col ? inferFieldTypeFromColumn(col) : field.field_type;
                          updateField(idx, {
                            target_column_id: col ? col.id : null,
                            target_column_title: col ? col.title : null,
                            target_column_type: col ? col.type : null,
                            field_type: nextType,
                            settings_json: col
                              ? getDefaultSettingsForFieldType(nextType, col)
                              : field.settings_json
                          });
                        }}
                        className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                      >
                        <option value="">— Select Column —</option>
                        {columns.filter(c => ALLOWED_SMARTSHEET_TYPES.includes(c.type)).map(col => (
                          <option key={col.id} value={col.id}>{col.title} ({col.type})</option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center pt-5">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={field.required}
                          onChange={(e) => updateField(idx, { required: e.target.checked })}
                          className="rounded border-zinc-300"
                        />
                        Required field
                      </label>
                    </div>
                  </>
                )}

                {field.field_type === "file" && (
                  <div className="sm:col-span-2 rounded border border-dashed border-zinc-300 bg-white px-3 py-3">
                    <p className="text-xs text-zinc-600">
                      File uploads stay in secure app storage and appear in reviewer attachments. They are not mapped directly to a Smartsheet column.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-4">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={field.required}
                          onChange={(e) => updateField(idx, { required: e.target.checked })}
                          className="rounded border-zinc-300"
                        />
                        Required file upload
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={Boolean(field.settings_json?.multiple)}
                          onChange={(e) => updateField(idx, {
                            settings_json: {
                              ...field.settings_json,
                              multiple: e.target.checked,
                            },
                          })}
                          className="rounded border-zinc-300"
                        />
                        Allow multiple PDFs
                      </label>
                    </div>
                  </div>
                )}

                {field.field_type === "select" && (
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-bold uppercase text-zinc-500">Options (one per line)</label>
                    <textarea
                      value={getSelectOptions(field).join("\n")}
                      onChange={(e) => updateField(idx, { 
                        settings_json: { ...field.settings_json, options: e.target.value.split("\n").filter(Boolean) } 
                      })}
                      rows={3}
                      className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                      placeholder="Enter options..."
                    />
                    <p className="mt-1 text-[10px] text-zinc-500">Must match Smartsheet picklist options exactly if mapped to a PICKLIST column.</p>
                  </div>
                )}
              </div>
            </div>
          ))}

          {fields.length === 0 && (
            <p className="py-8 text-center text-sm text-zinc-500">
              No questions added yet. Use the Add questions panel above to start from a Smartsheet column or add a file upload prompt.
            </p>
          )}
        </div>
      </AccordionCard>

      <AccordionCard title="Submissions" defaultOpen={false}>
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <p className="text-sm text-zinc-600">Audit of nomination attempts.</p>
            <button onClick={loadSubmissions} className="text-xs text-blue-600 hover:underline">Refresh</button>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-zinc-500">
              <thead className="bg-zinc-50 text-xs font-bold uppercase text-zinc-700">
                <tr>
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Submitter</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Smartsheet Row</th>
                  <th className="px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {submissions.map((s) => (
                  <tr key={s.submission_id} className="hover:bg-zinc-50">
                    <td className="whitespace-nowrap px-4 py-3">{new Date(s.created_at).toLocaleString()}</td>
                    <td className="px-4 py-3">{s.submitter_email}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                        s.status === "completed" ? "bg-green-100 text-green-700" :
                        s.status === "processing" ? "bg-blue-100 text-blue-700" :
                        "bg-red-100 text-red-700"
                      }`}>
                        {s.status}{s.is_resolved ? " / resolved" : ""}
                      </span>
                    </td>
                    <td className="px-4 py-3">{s.smartsheet_row_id || "—"}</td>
                    <td className="px-4 py-3 text-xs">
                      <div className="flex gap-3">
                        {s.status !== "completed" && (
                          <button onClick={() => handleRetry(s.submission_id)} className="text-blue-600 hover:underline">Retry</button>
                        )}
                        {!s.is_resolved && s.status !== "completed" && (
                          <button onClick={() => handleResolve(s.submission_id)} className="text-amber-700 hover:underline">Resolve</button>
                        )}
                        <button onClick={() => handleDeleteSubmission(s.submission_id)} className="text-red-600 hover:underline">Delete</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {submissions.length === 0 && !loadingSubmissions && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-zinc-400">No submissions found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </AccordionCard>

      <div className="flex justify-between border-t border-zinc-200 pt-6">
        <Link
          href={`/admin/scholarships/${programId}/cycles/${cycleId}`}
          className="rounded border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          Back to cycle
        </Link>
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={saving || publishing}
            className="rounded border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            {saving ? "Saving..." : "Save Draft"}
          </button>
          <button
            onClick={handlePublish}
            disabled={saving || publishing}
            className="rounded bg-[var(--wsu-crimson)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--wsu-crimson-hover)]"
          >
            {publishing ? "Publishing..." : "Publish Form"}
          </button>
        </div>
      </div>
    </div>
  );
}
