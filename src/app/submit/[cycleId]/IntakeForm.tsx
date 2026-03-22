"use client";

import React, { useEffect, useState } from "react";
import { put } from "@vercel/blob/client";
import { sanitizeRichTextHtml } from "@/lib/rich-text";
import type { SavedLayoutJson } from "@/lib/layout";
import { bindFieldsToLayout } from "@/lib/layout-runtime";

interface Field {
  field_key: string;
  label: string;
  help_text: string | null;
  field_type: string;
  required: boolean;
  settings_json: Record<string, unknown>;
}

interface FormSchema {
  cycleId: string;
  formVersionId: string;
  title: string;
  instructionsText: string | null;
  status: "open" | "scheduled" | "closed";
  opensAt: string | null;
  closesAt: string | null;
  layoutJson: SavedLayoutJson;
  fields: Field[];
  fileLimits: {
    maxSizeBytes: number;
    allowedContentTypes: string[];
  };
}

interface UploadedFileEntry {
  fieldKey: string;
  uploadId: string;
  blobPathname: string;
  blobUrl: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
}

function getStringValue(value: string | boolean | undefined): string {
  return typeof value === "string" ? value : "";
}

function getSelectOptions(field: Field): string[] {
  const options = field.settings_json?.options;
  if (!Array.isArray(options)) return [];
  return options.filter((option): option is string => typeof option === "string");
}

export default function IntakeForm({ cycleId }: { cycleId: string }) {
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [submissionId] = useState(() => crypto.randomUUID());
  const [formData, setFormData] = useState<Record<string, string | boolean>>({});
  const [files, setFiles] = useState<Record<string, UploadedFileEntry[]>>({});
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [draggingFieldKey, setDraggingFieldKey] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/submit/${cycleId}`)
      .then(async (res) => {
        if (!res.ok) {
          const d = await res.json();
          throw new Error(d.error || "Failed to load form");
        }
        return res.json();
      })
      .then(setSchema)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [cycleId]);

  const uploadFilesForField = async (
    fieldKey: string,
    allowMultiple: boolean,
    selectedFiles: File[]
  ) => {
    const filesToUpload = allowMultiple ? selectedFiles : selectedFiles.slice(0, 1);
    if (filesToUpload.length === 0) return;

    setUploading((current) => ({ ...current, [fieldKey]: true }));
    setError("");

    try {
      const uploadedEntries: UploadedFileEntry[] = [];

      for (const file of filesToUpload) {
        if (file.type !== "application/pdf") {
          throw new Error("Only PDF files are allowed");
        }

        if (file.size > (schema?.fileLimits.maxSizeBytes || 104857600)) {
          throw new Error("File size exceeds 100MB limit");
        }

        const uploadId = crypto.randomUUID();
        const tokenRes = await fetch(`/api/submit/${cycleId}/upload-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            submissionId,
            fieldKey,
            uploadId,
            filename: file.name,
            contentType: file.type,
            sizeBytes: file.size,
            honeypot: getStringValue(formData._honeypot),
          })
        });

        if (!tokenRes.ok) {
          const d = await tokenRes.json();
          throw new Error(d.error || "Failed to authorize upload");
        }

        const { token, pathname } = await tokenRes.json();

        const blob = await put(pathname, file, {
          access: "private",
          token,
          contentType: file.type,
          multipart: true,
        });

        uploadedEntries.push({
          fieldKey,
          uploadId,
          blobPathname: blob.pathname,
          blobUrl: blob.url,
          originalFilename: file.name,
          contentType: file.type,
          sizeBytes: file.size,
        });
      }

      setFiles((current) => ({
        ...current,
        [fieldKey]: allowMultiple
          ? [...(current[fieldKey] || []), ...uploadedEntries]
          : uploadedEntries,
      }));
    } catch (err: any) {
      setError(`Upload failed: ${err.message}`);
    } finally {
      setUploading((current) => ({ ...current, [fieldKey]: false }));
      setDraggingFieldKey((current) => (current === fieldKey ? null : current));
    }
  };

  const handleFileChange = async (
    fieldKey: string,
    allowMultiple: boolean,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const selectedFiles = Array.from(e.target.files || []);
    try {
      await uploadFilesForField(fieldKey, allowMultiple, selectedFiles);
    } finally {
      e.target.value = "";
    }
  };

  async function removeUploadedFile(fieldKey: string, blobPathname: string) {
    setError("");
    try {
      const res = await fetch(`/api/submit/${cycleId}/remove-upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId,
          fieldKey,
          blobPathname,
          honeypot: getStringValue(formData._honeypot),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to remove upload");
      }

      setFiles((current) => ({
        ...current,
        [fieldKey]: (current[fieldKey] || []).filter((file) => file.blobPathname !== blobPathname),
      }));
    } catch (err: any) {
      setError(err.message || "Failed to remove upload");
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    setError("");
    setSubmitting(true);

    try {
      const submissionFields = Object.fromEntries(
        Object.entries(formData).filter(([key]) => !key.startsWith("_"))
      );

      const res = await fetch(`/api/submit/${cycleId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId,
          formVersionId: schema?.formVersionId,
          submitterEmail: getStringValue(formData._submitterEmail),
          honeypot: getStringValue(formData._honeypot),
          fields: submissionFields,
          files: Object.values(files).flat()
        })
      });

      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || "Submission failed");
      }

      setSubmitted(true);
      window.scrollTo(0, 0);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="p-8 text-center text-zinc-500">Loading form...</div>;
  if (error && !schema) return <div className="p-8 text-center text-red-600 font-medium">{error}</div>;
  if (!schema) return null;
  const instructionsHtml = sanitizeRichTextHtml(schema.instructionsText);
  const boundLayout = bindFieldsToLayout({
    layoutJson: schema.layoutJson,
    fields: schema.fields,
    getFieldKey: (field) => field.field_key,
    sections: [{ section_key: "main", label: "Main", sort_order: 0 }],
  });
  const layoutRows = boundLayout.sections[0]?.rows ?? [];

  if (schema.status !== "open") {
    return (
      <div className="mx-auto max-w-2xl p-8 text-center">
        <h1 className="text-2xl font-bold text-zinc-900">{schema.title}</h1>
        <p className="mt-4 text-zinc-600">
          {schema.status === "scheduled" 
            ? `This form is not yet open. It is scheduled to open on ${new Date(schema.opensAt!).toLocaleString()}.`
            : "This form is currently closed and no longer accepting submissions."}
        </p>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="mx-auto max-w-2xl p-8 text-center">
        <div className="mb-4 text-4xl">✅</div>
        <h1 className="text-2xl font-bold text-zinc-900">Submission Received</h1>
        <p className="mt-4 text-zinc-600">
          Thank you. Your nomination has been submitted successfully.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-8 text-sm font-medium text-[var(--wsu-crimson)] hover:underline"
        >
          Submit another nomination
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <div className="mb-10 text-center">
        <img src="/wsu-logo.png" alt="WSU Graduate School" className="mx-auto mb-6 h-12 w-auto" />
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">{schema.title}</h1>
        {instructionsHtml && (
          <div
            className="mt-4 text-left text-base text-zinc-600 [&_a]:text-[var(--wsu-crimson)] [&_a]:underline [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-3 [&_ul]:list-disc [&_ul]:pl-6"
            dangerouslySetInnerHTML={{ __html: instructionsHtml }}
          />
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-8 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-10">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
            {error}
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-2">
          {/* Submitter Info */}
          <div className="pb-6 border-b border-zinc-100 md:col-span-2">
            <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-500 mb-4">Your Information</h2>
            <div>
              <label className="block text-sm font-medium text-zinc-700">
                Your @wsu.edu Email <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                required
                placeholder="your.name@wsu.edu"
                value={getStringValue(formData._submitterEmail)}
                onChange={(e) => setFormData({ ...formData, _submitterEmail: e.target.value })}
                className="mt-1 w-full rounded-lg border border-zinc-300 px-4 py-2.5 text-zinc-900 shadow-sm focus:border-[var(--wsu-crimson)] focus:ring-1 focus:ring-[var(--wsu-crimson)]"
              />
            </div>
            <div className="hidden" aria-hidden="true">
              <label htmlFor="intake-honeypot">Leave this field blank</label>
              <input
                id="intake-honeypot"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={getStringValue(formData._honeypot)}
                onChange={(e) => setFormData({ ...formData, _honeypot: e.target.value })}
              />
            </div>
          </div>

          <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-500 mb-4 md:col-span-2">Nomination Details</h2>

          {layoutRows.map((row) => {
            const rowItems = row.items;
            return (
              <div
                key={row.row_key}
                className={
                  rowItems.length === 3
                    ? "grid gap-6 md:col-span-2 md:grid-cols-3"
                    : rowItems.length === 2
                      ? "grid gap-6 md:col-span-2 md:grid-cols-2"
                    : "md:col-span-2"
                }
              >
                {rowItems.map(({ field }) => {
            const id = `field_${field.field_key}`;
            const fieldFiles = files[field.field_key] || [];
            const allowMultiple = Boolean(field.settings_json?.multiple);

            return (
              <div
                key={field.field_key}
                className={rowItems.length === 1 ? "md:col-span-2" : ""}
              >
                <label htmlFor={id} className="block text-sm font-medium text-zinc-700">
                  {field.label} {field.required && <span className="text-red-500">*</span>}
                </label>
                {field.help_text && <p className="mt-1 text-xs text-zinc-500 mb-2">{field.help_text}</p>}

                {field.field_type === "short_text" || field.field_type === "email" || field.field_type === "number" || field.field_type === "date" ? (
                  <input
                    type={field.field_type === "email" ? "email" : field.field_type === "number" ? "number" : field.field_type === "date" ? "date" : "text"}
                    id={id}
                    required={field.required}
                    value={getStringValue(formData[field.field_key])}
                    onChange={(e) => setFormData({ ...formData, [field.field_key]: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-4 py-2.5 text-zinc-900 shadow-sm focus:border-[var(--wsu-crimson)] focus:ring-1 focus:ring-[var(--wsu-crimson)]"
                  />
                ) : field.field_type === "long_text" ? (
                  <textarea
                    id={id}
                    required={field.required}
                    rows={5}
                    value={getStringValue(formData[field.field_key])}
                    onChange={(e) => setFormData({ ...formData, [field.field_key]: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-4 py-2.5 text-zinc-900 shadow-sm focus:border-[var(--wsu-crimson)] focus:ring-1 focus:ring-[var(--wsu-crimson)]"
                  />
                ) : field.field_type === "select" ? (
                  <select
                    id={id}
                    required={field.required}
                    value={getStringValue(formData[field.field_key])}
                    onChange={(e) => setFormData({ ...formData, [field.field_key]: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-4 py-2.5 text-zinc-900 shadow-sm focus:border-[var(--wsu-crimson)] focus:ring-1 focus:ring-[var(--wsu-crimson)]"
                  >
                    <option value="">— Select Option —</option>
                    {getSelectOptions(field).map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                ) : field.field_type === "checkbox" ? (
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="checkbox"
                      id={id}
                      checked={!!formData[field.field_key]}
                      onChange={(e) => setFormData({ ...formData, [field.field_key]: e.target.checked })}
                      className="h-5 w-5 rounded border-zinc-300 text-[var(--wsu-crimson)] focus:ring-[var(--wsu-crimson)]"
                    />
                    <span className="text-sm text-zinc-600">Yes / Confirmed</span>
                  </div>
                ) : field.field_type === "file" ? (
                  <div className="mt-1">
                    <input
                      type="file"
                      id={id}
                      required={field.required && fieldFiles.length === 0}
                      accept=".pdf,application/pdf"
                      multiple={allowMultiple}
                      onChange={(e) => handleFileChange(field.field_key, allowMultiple, e)}
                      disabled={uploading[field.field_key]}
                      className="sr-only"
                    />
                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        if (!uploading[field.field_key]) setDraggingFieldKey(field.field_key);
                      }}
                      onDragLeave={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                          setDraggingFieldKey((current) => (current === field.field_key ? null : current));
                        }
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (uploading[field.field_key]) return;
                        const droppedFiles = Array.from(e.dataTransfer.files || []);
                        void uploadFilesForField(field.field_key, allowMultiple, droppedFiles);
                      }}
                      className={`rounded-lg border-2 border-dashed px-4 py-5 text-center transition ${
                        draggingFieldKey === field.field_key
                          ? "border-[var(--wsu-crimson)] bg-rose-50"
                          : "border-zinc-300 bg-zinc-50"
                      }`}
                    >
                      <p className="text-sm font-medium text-zinc-800">
                        Drag and drop PDF files here
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {allowMultiple ? "You may upload multiple PDF files for this question." : "Upload one PDF file for this question."}
                      </p>
                      <label
                        htmlFor={id}
                        className="mt-3 inline-flex cursor-pointer items-center rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
                      >
                        Choose PDF{allowMultiple ? "s" : ""}
                      </label>
                    </div>
                    {uploading[field.field_key] && (
                      <p className="mt-2 text-xs text-blue-600 animate-pulse font-medium">Uploading to secure storage...</p>
                    )}
                    {fieldFiles.length > 0 && (
                      <ul className="mt-3 space-y-2">
                        {fieldFiles.map((file) => (
                          <li
                            key={file.blobPathname}
                            className="flex items-center justify-between rounded border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700"
                          >
                            <span>Uploaded: {file.originalFilename}</span>
                            <button
                              type="button"
                              onClick={() => removeUploadedFile(field.field_key, file.blobPathname)}
                              className="font-medium text-red-600 hover:underline"
                            >
                              Remove
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
              </div>
            );
                })}
              </div>
            );
          })}
        </div>

        <div className="pt-6">
          <button
            type="submit"
            disabled={submitting || Object.values(uploading).some(Boolean)}
            className="w-full rounded-lg bg-[var(--wsu-crimson)] py-4 text-lg font-bold text-white shadow-lg hover:bg-[var(--wsu-crimson-hover)] disabled:opacity-50 transition-all active:scale-[0.98]"
          >
            {submitting ? "Processing Submission..." : "Submit Nomination"}
          </button>
          <p className="mt-4 text-center text-[11px] text-zinc-400">
            By submitting this form, you are creating a record in Smartsheet. 
            All uploads are stored securely in private cloud storage.
          </p>
        </div>
      </form>
    </div>
  );
}
