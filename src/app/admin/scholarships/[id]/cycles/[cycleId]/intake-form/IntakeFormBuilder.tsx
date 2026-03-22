"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

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
  settings_json: any;
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

const ALLOWED_SMARTSHEET_TYPES = ["TEXT_NUMBER", "PICKLIST", "DATE", "CHECKBOX"];

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

  const addField = (type: string) => {
    const key = `field_${Date.now()}`;
    const newField: IntakeField = {
      field_key: key,
      label: "New Field",
      help_text: "",
      field_type: type,
      required: false,
      target_column_id: null,
      target_column_title: null,
      target_column_type: null,
      settings_json: type === "select" ? { options: [] } : {}
    };
    setFields([...fields, newField]);
  };

  const removeField = (index: number) => {
    setFields(fields.filter((_, i) => i !== index));
  };

  const updateField = (index: number, updates: Partial<IntakeField>) => {
    const next = [...fields];
    next[index] = { ...next[index], ...updates };
    setFields(next);
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
            <label className="block text-sm font-medium text-zinc-700">Instructions (Plain Text)</label>
            <textarea
              value={form.instructions_text || ""}
              onChange={(e) => setForm({ ...form, instructions_text: e.target.value })}
              rows={3}
              className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
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
          {fields.map((field, idx) => (
            <div key={idx} className="relative rounded-lg border border-zinc-200 bg-zinc-50 p-4">
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

                {field.field_type !== "file" && (
                  <>
                    <div>
                      <label className="block text-[11px] font-bold uppercase text-zinc-500">Target Smartsheet Column</label>
                      <select
                        value={field.target_column_id || ""}
                        onChange={(e) => {
                          const col = columns.find(c => String(c.id) === e.target.value);
                          updateField(idx, {
                            target_column_id: col ? col.id : null,
                            target_column_title: col ? col.title : null,
                            target_column_type: col ? col.type : null
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
                  <div className="flex items-center pt-5">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={field.required}
                        onChange={(e) => updateField(idx, { required: e.target.checked })}
                        className="rounded border-zinc-300"
                      />
                      Required file upload
                    </label>
                  </div>
                )}

                {field.field_type === "select" && (
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-bold uppercase text-zinc-500">Options (one per line)</label>
                    <textarea
                      value={field.settings_json?.options?.join("\n") || ""}
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
            <p className="py-8 text-center text-sm text-zinc-500">No fields added yet. Use the buttons below to start building your form.</p>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            {FIELD_TYPES.map(type => (
              <button
                key={type.value}
                onClick={() => addField(type.value)}
                className="rounded border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              >
                + {type.label}
              </button>
            ))}
          </div>
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
