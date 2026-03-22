"use client";

import React, { useEffect, useState } from "react";
import { put } from "@vercel/blob/client";

interface Field {
  field_key: string;
  label: string;
  help_text: string | null;
  field_type: string;
  required: boolean;
  settings_json: any;
}

interface FormSchema {
  cycleId: string;
  formVersionId: string;
  title: string;
  instructionsText: string | null;
  status: "open" | "scheduled" | "closed";
  opensAt: string | null;
  closesAt: string | null;
  fields: Field[];
  fileLimits: {
    maxSizeBytes: number;
    allowedContentTypes: string[];
  };
}

export default function IntakeForm({ cycleId }: { cycleId: string }) {
  const [schema, setSchema] = useState<FormSchema | null>(null);
  const [submissionId] = useState(() => crypto.randomUUID());
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [files, setFiles] = useState<Record<string, any>>({});
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
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

  const handleFileChange = async (fieldKey: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== "application/pdf") {
      alert("Only PDF files are allowed");
      return;
    }

    if (file.size > (schema?.fileLimits.maxSizeBytes || 104857600)) {
      alert("File size exceeds 100MB limit");
      return;
    }

    setUploading((current) => ({ ...current, [fieldKey]: true }));
    setError("");

    try {
      // 1. Get upload token
      const tokenRes = await fetch(`/api/submit/${cycleId}/upload-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId,
          fieldKey,
          filename: file.name,
          contentType: file.type,
          sizeBytes: file.size,
          honeypot: formData._honeypot || "",
        })
      });

      if (!tokenRes.ok) {
        const d = await tokenRes.json();
        throw new Error(d.error || "Failed to authorize upload");
      }

      const { token, pathname } = await tokenRes.json();

      // 2. Upload directly to Blob
      const blob = await put(pathname, file, {
        access: "private",
        token,
        contentType: file.type,
        multipart: true,
      });

      setFiles((current) => ({
        ...current,
        [fieldKey]: {
          fieldKey,
          blobPathname: blob.pathname,
          blobUrl: blob.url,
          originalFilename: file.name,
          contentType: file.type,
          sizeBytes: file.size
        }
      }));
    } catch (err: any) {
      setError(`Upload failed: ${err.message}`);
    } finally {
      setUploading((current) => ({ ...current, [fieldKey]: false }));
    }
  };

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
          submitterEmail: formData._submitterEmail,
          honeypot: formData._honeypot || "",
          fields: submissionFields,
          files: Object.values(files)
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
        <img src="/wsu-logo.svg" alt="WSU Logo" className="mx-auto h-12 w-auto mb-6" />
        <h1 className="text-3xl font-bold tracking-tight text-zinc-900 sm:text-4xl">{schema.title}</h1>
        {schema.instructionsText && (
          <p className="mt-4 text-lg text-zinc-600 whitespace-pre-wrap">{schema.instructionsText}</p>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-8 rounded-xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-10">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
            {error}
          </div>
        )}

        <div className="space-y-6">
          {/* Submitter Info */}
          <div className="pb-6 border-b border-zinc-100">
            <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-500 mb-4">Your Information</h2>
            <div>
              <label className="block text-sm font-medium text-zinc-700">
                Your @wsu.edu Email <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                required
                placeholder="your.name@wsu.edu"
                value={formData._submitterEmail || ""}
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
                value={formData._honeypot || ""}
                onChange={(e) => setFormData({ ...formData, _honeypot: e.target.value })}
              />
            </div>
          </div>

          <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-500 mb-4">Nomination Details</h2>

          {schema.fields.map((field) => {
            const id = `field_${field.field_key}`;

            return (
              <div key={field.field_key}>
                <label htmlFor={id} className="block text-sm font-medium text-zinc-700">
                  {field.label} {field.required && <span className="text-red-500">*</span>}
                </label>
                {field.help_text && <p className="mt-1 text-xs text-zinc-500 mb-2">{field.help_text}</p>}

                {field.field_type === "short_text" || field.field_type === "email" || field.field_type === "number" || field.field_type === "date" ? (
                  <input
                    type={field.field_type === "email" ? "email" : field.field_type === "number" ? "number" : field.field_type === "date" ? "date" : "text"}
                    id={id}
                    required={field.required}
                    value={formData[field.field_key] || ""}
                    onChange={(e) => setFormData({ ...formData, [field.field_key]: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-4 py-2.5 text-zinc-900 shadow-sm focus:border-[var(--wsu-crimson)] focus:ring-1 focus:ring-[var(--wsu-crimson)]"
                  />
                ) : field.field_type === "long_text" ? (
                  <textarea
                    id={id}
                    required={field.required}
                    rows={5}
                    value={formData[field.field_key] || ""}
                    onChange={(e) => setFormData({ ...formData, [field.field_key]: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-4 py-2.5 text-zinc-900 shadow-sm focus:border-[var(--wsu-crimson)] focus:ring-1 focus:ring-[var(--wsu-crimson)]"
                  />
                ) : field.field_type === "select" ? (
                  <select
                    id={id}
                    required={field.required}
                    value={formData[field.field_key] || ""}
                    onChange={(e) => setFormData({ ...formData, [field.field_key]: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-zinc-300 px-4 py-2.5 text-zinc-900 shadow-sm focus:border-[var(--wsu-crimson)] focus:ring-1 focus:ring-[var(--wsu-crimson)]"
                  >
                    <option value="">— Select Option —</option>
                    {(field.settings_json?.options || []).map((opt: string) => (
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
                      required={field.required && !files[field.field_key]}
                      accept=".pdf,application/pdf"
                      onChange={(e) => handleFileChange(field.field_key, e)}
                      disabled={uploading[field.field_key]}
                      className="block w-full text-sm text-zinc-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-zinc-100 file:text-zinc-700 hover:file:bg-zinc-200"
                    />
                    {uploading[field.field_key] && (
                      <p className="mt-2 text-xs text-blue-600 animate-pulse font-medium">Uploading to secure storage...</p>
                    )}
                    {files[field.field_key] && (
                      <p className="mt-2 text-xs text-green-600 font-medium">
                        ✓ {files[field.field_key].originalFilename} uploaded
                      </p>
                    )}
                  </div>
                ) : null}
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
