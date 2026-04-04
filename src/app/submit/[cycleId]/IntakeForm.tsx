"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import { put } from "@vercel/blob/client";
import { sanitizeRichTextHtml } from "@/lib/rich-text";
import type { SavedLayoutJson } from "@/lib/layout";
import { bindFieldsToLayout, getBoundRowDesktopColumnCount } from "@/lib/layout-runtime";
import {
  isIntakeTextFieldType,
  parseIntakeTextMaxLength,
} from "@/lib/intake-settings";

interface Field {
  field_key: string;
  label: string;
  help_text: string | null;
  field_type: string;
  required: boolean;
  settings_json: Record<string, unknown>;
  push_to_smartsheet?: boolean;
  /** Server-computed cap for PDF uploads (30 MB when mirroring, else 100 MB) */
  maxFileSizeBytes?: number;
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

function getFieldMaxLength(field: Field): number | undefined {
  if (!isIntakeTextFieldType(field.field_type)) return undefined;
  return parseIntakeTextMaxLength(field.settings_json?.maxLength) ?? undefined;
}

function shouldRenderMultilineTextField(field: Field, maxLength: number | undefined): boolean {
  return field.field_type === "long_text" || (field.field_type === "short_text" && (maxLength ?? 0) > 255);
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function getLongTextRows(value: string): number {
  const lines = value.split("\n");
  const estimatedWrappedLines = lines.reduce(
    (count, line) => count + Math.max(1, Math.ceil(line.length / 90)),
    0
  );
  return Math.min(20, Math.max(10, estimatedWrappedLines));
}

async function readResponseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(`Empty response from server (HTTP ${res.status}).`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Invalid response (HTTP ${res.status}): ${text.slice(0, 100)}...`);
  }
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
    async function load() {
      try {
        const res = await fetch(`/api/submit/${cycleId}`);
        const data = await readResponseJson<FormSchema & { error?: string }>(res);
        if (!res.ok) {
          throw new Error(data.error || "Failed to load form");
        }
        setSchema(data);
      } catch (err: unknown) {
        setError(getErrorMessage(err, "Failed to load form"));
      } finally {
        setLoading(false);
      }
    }
    void load();
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

      const fieldCfg = schema?.fields.find((f) => f.field_key === fieldKey);
      const maxBytes =
        fieldCfg?.maxFileSizeBytes ?? schema?.fileLimits.maxSizeBytes ?? 104857600;

      for (const file of filesToUpload) {
        if (file.type !== "application/pdf") {
          throw new Error("Only PDF files are allowed");
        }

        if (file.size > maxBytes) {
          throw new Error(
            maxBytes <= 30 * 1024 * 1024
              ? "File size exceeds 30 MB limit for this field"
              : "File size exceeds 100 MB limit"
          );
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

        const tokenData = await readResponseJson<{ token: string; pathname: string; error?: string }>(tokenRes);
        if (!tokenRes.ok) {
          throw new Error(tokenData.error || "Failed to authorize upload");
        }

        const { token, pathname } = tokenData;

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
    } catch (err: unknown) {
      setError(`Upload failed: ${getErrorMessage(err, "Unexpected error")}`);
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

      const data = await readResponseJson<{ error?: string }>(res).catch(() => ({ error: undefined }));
      if (!res.ok) {
        throw new Error(data.error || "Failed to remove upload");
      }

      setFiles((current) => ({
        ...current,
        [fieldKey]: (current[fieldKey] || []).filter((file) => file.blobPathname !== blobPathname),
      }));
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Failed to remove upload"));
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

      const d = await readResponseJson<{ error?: string }>(res).catch(() => ({ error: undefined }));
      if (!res.ok) {
        throw new Error(d.error || "Submission failed");
      }

      setSubmitted(true);
      window.scrollTo(0, 0);
    } catch (err: unknown) {
      setError(getErrorMessage(err, "Submission failed"));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6" aria-busy="true" aria-label="Loading nomination form">
        <div className="animate-pulse space-y-6 rounded-xl border border-zinc-200 bg-white p-8 shadow-sm sm:p-10">
          <div className="flex flex-col items-center gap-4">
            <div className="h-12 w-12 rounded bg-zinc-200" />
            <div className="h-9 w-[min(100%,20rem)] rounded-lg bg-zinc-200" />
            <div className="h-4 w-full max-w-xl rounded bg-zinc-100" />
            <div className="h-4 w-full max-w-lg rounded bg-zinc-100" />
          </div>
          <div className="space-y-3 border-t border-zinc-100 pt-6">
            <div className="h-10 rounded-lg bg-zinc-100" />
            <div className="h-10 rounded-lg bg-zinc-100" />
            <div className="h-40 rounded-lg bg-zinc-100" />
          </div>
        </div>
      </div>
    );
  }

  if (error && !schema) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center sm:px-6">
        <div className="rounded-xl border border-red-200 bg-red-50 p-8 shadow-sm" role="alert">
          <h1 className="text-lg font-semibold text-red-900">This form cannot be loaded</h1>
          <p className="mt-3 text-sm leading-relaxed text-red-800">{error}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-red-900 shadow-sm ring-1 ring-red-200 transition hover:bg-red-100/80"
          >
            Reload page
          </button>
        </div>
      </div>
    );
  }

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
    const opensHuman =
      schema.status === "scheduled" && schema.opensAt
        ? new Date(schema.opensAt).toLocaleString(undefined, {
            dateStyle: "full",
            timeStyle: "short",
          })
        : null;
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
        <div className="rounded-2xl border border-zinc-200 bg-white p-10 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            {schema.status === "scheduled" ? "Not yet open" : "Closed"}
          </p>
          <h1 className="mt-3 text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
            {schema.title}
          </h1>
          <p className="mt-5 text-base leading-relaxed text-zinc-600">
            {schema.status === "scheduled" && opensHuman
              ? `This form opens on ${opensHuman}. Please return after that time.`
              : "This form is closed and is no longer accepting nominations."}
          </p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-10 shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
            <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="mt-6 text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
            Submission received
          </h1>
          <p className="mt-4 text-base leading-relaxed text-zinc-700">
            Thank you. Your nomination was submitted and is being processed.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-8 rounded-lg bg-[var(--wsu-crimson)] px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[var(--wsu-crimson-hover)]"
          >
            Submit another nomination
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <div className="mb-10 text-center">
        <Image
          src="/wsu-logo.png"
          alt="Washington State University Graduate School"
          width={220}
          height={56}
          className="mx-auto mb-6 h-12 w-auto object-contain"
          priority
        />
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
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm leading-relaxed text-red-800 shadow-sm" role="alert">
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
              <label htmlFor="intake-honeypot" aria-hidden="true">
                Leave this field blank
              </label>
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
            const desktopColumns = getBoundRowDesktopColumnCount(row);
            return (
              <div
                key={row.row_key}
                className={
                  desktopColumns >= 2
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
                className="min-w-0"
              >
                {(() => {
                  const maxLength = getFieldMaxLength(field);
                  const currentLength = getStringValue(formData[field.field_key]).length;
                  const useTextarea = shouldRenderMultilineTextField(field, maxLength);

                  return (
                    <>
                <label htmlFor={id} className="block text-sm font-medium leading-5 text-zinc-700">
                  {field.label} {field.required && <span className="text-red-500">*</span>}
                </label>
                {field.help_text && <p className="mt-1 text-xs text-zinc-500 mb-2">{field.help_text}</p>}

                {useTextarea ? (
                  <>
                    <textarea
                      id={id}
                      required={field.required}
                      rows={getLongTextRows(getStringValue(formData[field.field_key]))}
                      maxLength={maxLength}
                      value={getStringValue(formData[field.field_key])}
                      onChange={(e) => setFormData({ ...formData, [field.field_key]: e.target.value })}
                      className="mt-1 w-full min-h-[16rem] resize-y rounded-lg border border-zinc-300 px-4 py-2.5 text-zinc-900 shadow-sm focus:border-[var(--wsu-crimson)] focus:ring-1 focus:ring-[var(--wsu-crimson)]"
                    />
                    {maxLength && (
                      <p className="mt-2 text-xs text-zinc-500">
                        {currentLength}/{maxLength} characters
                      </p>
                    )}
                  </>
                ) : field.field_type === "short_text" || field.field_type === "email" || field.field_type === "number" || field.field_type === "date" ? (
                  <>
                    <input
                      type={field.field_type === "email" ? "email" : field.field_type === "number" ? "number" : field.field_type === "date" ? "date" : "text"}
                      id={id}
                      required={field.required}
                      maxLength={field.field_type === "short_text" ? maxLength : undefined}
                      value={getStringValue(formData[field.field_key])}
                      onChange={(e) => setFormData({ ...formData, [field.field_key]: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-zinc-300 px-4 py-2.5 text-zinc-900 shadow-sm focus:border-[var(--wsu-crimson)] focus:ring-1 focus:ring-[var(--wsu-crimson)]"
                    />
                    {field.field_type === "short_text" && maxLength && (
                      <p className="mt-2 text-xs text-zinc-500">
                        {currentLength}/{maxLength} characters
                      </p>
                    )}
                  </>
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
                      aria-busy={!!uploading[field.field_key]}
                      className={`rounded-lg border-2 border-dashed px-4 py-5 text-center transition-colors ${
                        draggingFieldKey === field.field_key
                          ? "border-[var(--wsu-crimson)] bg-rose-50"
                          : "border-zinc-300 bg-zinc-50"
                      } ${uploading[field.field_key] ? "pointer-events-none opacity-70" : ""}`}
                    >
                      <p className="text-sm font-medium text-zinc-800">
                        Drag and drop PDF files here
                      </p>
                      <p className="mt-1 text-xs text-zinc-500">
                        {allowMultiple ? "You may upload multiple PDF files for this question." : "Upload one PDF file for this question."}{" "}
                        Maximum size{" "}
                        {field.maxFileSizeBytes && field.maxFileSizeBytes <= 30 * 1024 * 1024
                          ? "30 MB"
                          : "100 MB"}
                        .
                        {field.push_to_smartsheet
                          ? " Files from this field will be mirrored to Smartsheet after submission."
                          : ""}
                      </p>
                      <label
                        htmlFor={id}
                        className="mt-3 inline-flex cursor-pointer items-center rounded border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
                      >
                        Choose PDF{allowMultiple ? "s" : ""}
                      </label>
                    </div>
                    {uploading[field.field_key] && (
                      <p className="mt-2 text-xs font-medium text-blue-700" role="status" aria-live="polite">
                        Uploading… secure storage
                      </p>
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
                              className="rounded-sm font-medium text-red-700 underline-offset-2 hover:underline"
                            >
                              Remove
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null}
                    </>
                  );
                })()}
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
            aria-busy={submitting}
            className="w-full rounded-lg bg-[var(--wsu-crimson)] py-4 text-lg font-bold text-white shadow-md transition-colors hover:bg-[var(--wsu-crimson-hover)] disabled:cursor-not-allowed disabled:opacity-55 active:scale-[0.99]"
          >
            {submitting ? "Submitting…" : "Submit nomination"}
          </button>
          {Object.values(uploading).some(Boolean) && (
            <p className="mt-3 text-center text-sm text-amber-800" role="status">
              Wait for uploads to finish before submitting.
            </p>
          )}
          <p className="mt-4 text-center text-xs leading-relaxed text-zinc-500">
            By submitting, you create a row in Smartsheet. Files stay in private storage until they are processed.
          </p>
        </div>
      </form>
    </div>
  );
}
