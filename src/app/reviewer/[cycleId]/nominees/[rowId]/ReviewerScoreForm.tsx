"use client";

import { put } from "@vercel/blob/client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { SavedLayoutJson } from "@/lib/layout";
import { bindFieldsToLayout } from "@/lib/layout-runtime";

type SaveState = "idle" | "unsaved_changes" | "saving" | "saved" | "failed";

interface LayoutColors {
  accent: string;
  headerBg: string;
  headerText: string;
  cardBg: string;
}
const DEFAULT_COLORS: LayoutColors = {
  accent: "#A60F2D",
  headerBg: "#ffffff",
  headerText: "#171717",
  cardBg: "#ffffff",
};

interface Field {
  fieldKey: string;
  sourceColumnId: number;
  purpose: string;
  displayLabel: string;
  displayType: string;
  canEdit: boolean;
  sectionKey?: string;
  value: unknown;
}

interface ViewSection {
  section_key: string;
  label: string;
  sort_order: number;
}

export function ReviewerScoreForm({
  cycleId,
  rowId,
}: {
  cycleId: string;
  rowId: number;
}) {
  const router = useRouter();
  const [fields, setFields] = useState<Field[]>([]);
  const [columnOptions, setColumnOptions] = useState<Record<number, string[]>>({});
  const [edits, setEdits] = useState<Record<number, unknown>>({});
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [retriable, setRetriable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [nomineeIds, setNomineeIds] = useState<number[]>([]);
  const [attachments, setAttachments] = useState<{ id: string; name: string; url?: string; source?: string }[]>([]);
  const [canUploadAttachments, setCanUploadAttachments] = useState(false);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [attachmentDragActive, setAttachmentDragActive] = useState(false);
  const [viewType, setViewType] = useState<string>("tabbed");
  const [viewSections, setViewSections] = useState<ViewSection[]>([]);
  const [activeTab, setActiveTab] = useState<string>("main");
  const [layoutJson, setLayoutJson] = useState<SavedLayoutJson | null>(null);
  const [colors, setColors] = useState<LayoutColors>(DEFAULT_COLORS);
  const [pinnedFieldKeys, setPinnedFieldKeys] = useState<string[]>([]);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  const loadAttachments = useCallback(async (shouldShowAttachments: boolean) => {
    if (!shouldShowAttachments) {
      setAttachments([]);
      return;
    }

    const attRes = await fetch(`/api/reviewer/cycles/${cycleId}/rows/${rowId}/attachments`);
    const attachmentsData = attRes.ok ? await attRes.json() : { attachments: [] };
    setAttachments((attachmentsData.attachments ?? []).map((a: { id: number | string; name: string; url?: string; source?: string }) => ({
      ...a,
      id: String(a.id),
    })));
  }, [cycleId, rowId]);

  const loadRow = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [configRes, rowRes, rowsRes] = await Promise.all([
        fetch(`/api/reviewer/cycles/${cycleId}/config`),
        fetch(`/api/reviewer/cycles/${cycleId}/rows/${rowId}`),
        fetch(`/api/reviewer/cycles/${cycleId}/rows`),
      ]);
      if (!configRes.ok) {
        const d = await configRes.json();
        setError(d.error ?? "Failed to load config");
        return;
      }
      if (!rowRes.ok) {
        const d = await rowRes.json();
        setError(d.error ?? "Failed to load nominee");
        return;
      }
      const configData = await configRes.json();
      const rowData = await rowRes.json();
      const rowsData = rowsRes.ok ? await rowsRes.json() : { rows: [] };
      await loadAttachments(configData.showAttachments === true);
      setColumnOptions(configData.columnOptions ?? {});
      const fieldsData = rowData.fields ?? [];
      setFields(fieldsData);
      const vType = configData.viewType ?? "tabbed";
      const vSections = configData.viewSections ?? [];
      setViewType(vType);
      setViewSections(vSections);
      if (vSections.length > 0) setActiveTab(vSections[0].section_key);
      setLayoutJson(configData.layoutJson ?? null);
      setColors({ ...DEFAULT_COLORS, ...(configData.colors ?? {}) });
      setPinnedFieldKeys(configData.pinnedFieldKeys ?? []);
      setCanUploadAttachments(configData.canUploadAttachments === true);
      const initial: Record<number, unknown> = {};
      for (const f of fieldsData) {
        initial[f.sourceColumnId] = f.value;
      }
      setEdits(initial);
      setLoadedAt(rowData.loadedAt ?? null);
      setNomineeIds((rowsData.rows ?? []).map((r: { id: number }) => r.id));
    } catch {
      setError("Failed to load");
    } finally {
      setLoading(false);
    }
  }, [cycleId, rowId, loadAttachments]);

  useEffect(() => {
    loadRow();
  }, [loadRow]);

  function handleChange(columnId: number, value: unknown) {
    setEdits((prev) => ({ ...prev, [columnId]: value }));
    setSaveState("unsaved_changes");
    setError(null);
  }

  async function uploadAttachmentFiles(selectedFiles: File[]) {
    if (!canUploadAttachments || selectedFiles.length === 0) return;

    setAttachmentError(null);
    setUploadingAttachments(true);
    try {
      for (const file of selectedFiles) {
        const uploadId = crypto.randomUUID();
        const tokenRes = await fetch(`/api/reviewer/cycles/${cycleId}/rows/${rowId}/attachments/upload-token`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            contentType: file.type || "application/octet-stream",
            sizeBytes: file.size,
            uploadId,
          }),
        });
        if (!tokenRes.ok) {
          const data = await tokenRes.json();
          throw new Error(data.error || "Failed to authorize attachment upload");
        }

        const { token, pathname } = await tokenRes.json();
        const blob = await put(pathname, file, {
          access: "private",
          token,
          contentType: file.type || "application/octet-stream",
          multipart: true,
        });

        const finalizeRes = await fetch(`/api/reviewer/cycles/${cycleId}/rows/${rowId}/attachments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            uploadId,
            blobPathname: blob.pathname,
            originalFilename: file.name,
            contentType: file.type || "application/octet-stream",
            sizeBytes: file.size,
          }),
        });
        if (!finalizeRes.ok) {
          const data = await finalizeRes.json();
          throw new Error(data.error || "Failed to attach uploaded file");
        }
      }

      await loadAttachments(true);
    } catch (err) {
      setAttachmentError(err instanceof Error ? err.message : "Failed to upload attachment");
    } finally {
      setUploadingAttachments(false);
      setAttachmentDragActive(false);
      if (attachmentInputRef.current) attachmentInputRef.current.value = "";
    }
  }

  async function handleSave(andNext: boolean) {
    setSaveState("saving");
    setError(null);
    try {
      const cells = Object.entries(edits).map(([colId, value]) => ({
        columnId: parseInt(colId, 10),
        value,
      }));
      const res = await fetch(`/api/reviewer/cycles/${cycleId}/rows/${rowId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cells }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveState("failed");
        setError(data.error ?? "Save failed");
        setRetriable(data.retriable ?? false);
        return;
      }
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2500);
      if (andNext && nomineeIds.length > 0) {
        const idx = nomineeIds.indexOf(rowId);
        const nextId = idx >= 0 && idx < nomineeIds.length - 1 ? nomineeIds[idx + 1] : null;
        if (nextId) {
          router.push(`/reviewer/${cycleId}/nominees/${nextId}`);
        } else {
          router.push(`/reviewer/${cycleId}`);
        }
      }
    } catch {
      setSaveState("failed");
      setError("Network error");
      setRetriable(true);
    }
  }

  const saveAndNextRef = useRef<() => void>(() => {});
  saveAndNextRef.current = () => {
    if (saveState !== "saving" && saveState !== "saved") handleSave(true);
  };
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        saveAndNextRef.current();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (loading) {
    return (
      <div className="mt-6 flex items-center gap-3 text-zinc-500" role="status" aria-live="polite">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-300 border-t-zinc-600" />
        <span>Loading…</span>
      </div>
    );
  }

  if (error && fields.length === 0) {
    return (
      <div className="mt-6 rounded border border-red-200 bg-red-50 p-4 text-red-900">
        {error}
      </div>
    );
  }

  const sections = viewSections.length > 0
    ? viewSections
    : [{ section_key: "main", label: "Review", sort_order: 0 }];
  const boundLayout = bindFieldsToLayout({
    layoutJson,
    fields,
    getFieldKey: (field) => field.fieldKey,
    sections,
    pinnedFieldKeys,
  });
  const pinnedFields = boundLayout.pinnedFields;
  const layoutSections = boundLayout.sections;
  const useTabs = viewType === "tabbed" && sections.length > 0;
  const useSections = ["tabbed", "stacked", "accordion"].includes(viewType) && sections.length > 0;

  function renderReadOnlyField(f: Field) {
    return (
      <div key={f.fieldKey} role="group" aria-labelledby={`label-${f.fieldKey}`}>
        <div id={`label-${f.fieldKey}`} className="text-xs font-medium text-zinc-600">{f.displayLabel}</div>
        <div className="mt-1 whitespace-pre-wrap text-zinc-900">
          {String(edits[f.sourceColumnId] ?? f.value ?? "")}
        </div>
      </div>
    );
  }
  function renderEditableField(f: Field) {
    return (
      <div key={f.fieldKey}>
        <label className="block text-sm font-medium text-zinc-700">{f.displayLabel}</label>
        {f.displayType === "score_select" ? (
          <select
            value={String(edits[f.sourceColumnId] ?? f.value ?? "")}
            onChange={(e) => handleChange(f.sourceColumnId, e.target.value || null)}
            className="mt-1 block w-full max-w-md rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
          >
            <option value="">— Select —</option>
            {(columnOptions[f.sourceColumnId] ?? []).map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        ) : (
          <textarea
            value={String(edits[f.sourceColumnId] ?? f.value ?? "")}
            onChange={(e) => handleChange(f.sourceColumnId, e.target.value)}
            rows={4}
            className="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
          />
        )}
      </div>
    );
  }

  function renderRow(row: { row_key: string; items: Array<{ field: Field }> }) {
    return (
      <div
        key={row.row_key}
        className={
          row.items.length === 3
            ? "grid gap-4 md:grid-cols-3"
            : row.items.length === 2
              ? "grid gap-4 md:grid-cols-2"
              : "space-y-4"
        }
      >
        {row.items.map(({ field }) =>
          field.canEdit ? renderEditableField(field) : renderReadOnlyField(field)
        )}
      </div>
    );
  }

  const currentIndex = nomineeIds.indexOf(rowId);
  const position = currentIndex >= 0 ? currentIndex + 1 : 0;
  const total = nomineeIds.length;
  const prevId = currentIndex > 0 ? nomineeIds[currentIndex - 1] : null;
  const nextId = currentIndex >= 0 && currentIndex < total - 1 ? nomineeIds[currentIndex + 1] : null;

  return (
    <div className="mt-6 space-y-6 pb-24">
      {total > 0 && (
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {prevId && (
                <Link
                  href={`/reviewer/${cycleId}/nominees/${prevId}`}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  ← Previous
                </Link>
              )}
              <span className="text-sm font-medium text-zinc-700">
                Nominee {position} of {total}
              </span>
              {nextId && (
                <Link
                  href={`/reviewer/${cycleId}/nominees/${nextId}`}
                  className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  Next →
                </Link>
              )}
            </div>
            <div className="min-w-[120px] flex-1 max-w-xs">
              <div className="h-2 overflow-hidden rounded-full bg-zinc-200">
                <div
                  className="h-full rounded-full bg-[var(--wsu-crimson)] transition-all duration-300"
                  style={{ width: `${total ? (position / total) * 100 : 0}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
      {(attachments.length > 0 || canUploadAttachments) && (
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="mb-3 font-medium text-zinc-900">Attachments</h2>
          {canUploadAttachments && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                if (!uploadingAttachments) setAttachmentDragActive(true);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                  setAttachmentDragActive(false);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (uploadingAttachments) return;
                const droppedFiles = Array.from(e.dataTransfer.files ?? []);
                void uploadAttachmentFiles(droppedFiles);
              }}
              className={`mb-4 rounded-lg border-2 border-dashed px-4 py-5 text-center transition ${
                attachmentDragActive
                  ? "border-[var(--wsu-crimson)] bg-rose-50"
                  : "border-zinc-300 bg-zinc-50"
              }`}
            >
              <input
                ref={attachmentInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => void uploadAttachmentFiles(Array.from(e.target.files ?? []))}
              />
              <p className="text-sm font-medium text-zinc-800">
                Drag files here to attach them to this nominee
              </p>
              <p className="mt-1 text-xs text-zinc-500">
                Stored in secure app storage and shown with the nominee attachments. Max 50 MB per file.
              </p>
              <button
                type="button"
                onClick={() => attachmentInputRef.current?.click()}
                disabled={uploadingAttachments}
                className="mt-3 rounded border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {uploadingAttachments ? "Uploading..." : "Choose files"}
              </button>
            </div>
          )}
          {attachmentError && (
            <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {attachmentError}
            </div>
          )}
          <ul className="space-y-2">
            {attachments.map((a) => (
              <li key={a.id}>
                {a.url ? (
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:underline"
                  >
                    {a.name}
                  </a>
                ) : (
                  <span className="text-sm text-zinc-600">{a.name}</span>
                )}
              </li>
            ))}
            {attachments.length === 0 && (
              <li className="text-sm text-zinc-500">No attachments yet.</li>
            )}
          </ul>
        </div>
      )}

      {pinnedFields.length > 0 && (
        <div
          className="rounded-lg border border-zinc-200 px-4 py-3"
          style={{ backgroundColor: colors.headerBg }}
        >
          <div className="flex flex-wrap gap-x-8 gap-y-1.5">
            {pinnedFields.map((f) => (
              <div key={f.fieldKey} role="group" aria-labelledby={`pinned-label-${f.fieldKey}`}>
                <div id={`pinned-label-${f.fieldKey}`} className="text-xs font-medium uppercase tracking-wide text-zinc-600">
                  {f.displayLabel}
                </div>
                <div className="text-sm font-semibold" style={{ color: colors.headerText }}>
                  {String(edits[f.sourceColumnId] ?? f.value ?? "—")}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {useTabs ? (
        <div className="rounded-lg border border-zinc-200" style={{ backgroundColor: colors.cardBg }}>
          <div className="flex border-b border-zinc-200">
            {sections.map((s) => {
              const isActive = activeTab === s.section_key;
              return (
                <button
                  key={s.section_key}
                  type="button"
                  onClick={() => setActiveTab(s.section_key)}
                  className={`-mb-px rounded-t px-4 py-2 text-sm font-medium ${
                    isActive ? "text-zinc-900" : "bg-zinc-50 text-zinc-500 hover:text-zinc-700"
                  }`}
                  style={isActive ? { borderBottom: `2px solid ${colors.accent}`, backgroundColor: colors.cardBg } : {}}
                >
                  {s.label}
                </button>
              );
            })}
          </div>
          <div className="p-4">
            <div className="space-y-4">
              {(layoutSections.find((section) => section.section_key === activeTab)?.rows ?? []).length > 0 ? (
                (layoutSections.find((section) => section.section_key === activeTab)?.rows ?? []).map(renderRow)
              ) : (
                <p className="text-sm text-zinc-500">No fields in this section.</p>
              )}
            </div>
          </div>
        </div>
      ) : useSections ? (
        viewType === "accordion" ? (
          <div className="space-y-2">
            {sections.map((s) => {
              const sectionRows =
                layoutSections.find((section) => section.section_key === s.section_key)?.rows ?? [];
              return (
                <details key={s.section_key} open className="rounded-lg border border-zinc-200 bg-white">
                  <summary className="cursor-pointer px-4 py-3 font-medium text-zinc-900">
                    {s.label}
                  </summary>
                  <div className="space-y-4 border-t border-zinc-200 px-4 pb-4 pt-3">
                    {sectionRows.length > 0 ? (
                      sectionRows.map(renderRow)
                    ) : (
                      <p className="text-sm text-zinc-500">No fields in this section.</p>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        ) : (
          <div className="space-y-4">
            {sections.map((s) => {
              const sectionRows =
                layoutSections.find((section) => section.section_key === s.section_key)?.rows ?? [];
              return (
                <div key={s.section_key} className="rounded-lg border border-zinc-200 bg-white p-4">
                  <h2 className="mb-3 font-medium text-zinc-900">{s.label}</h2>
                  <div className="space-y-4">
                    {sectionRows.length > 0 ? (
                      sectionRows.map(renderRow)
                    ) : (
                      <p className="text-sm text-zinc-500">No fields in this section.</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <div className="space-y-4">
            {layoutSections.flatMap((section) => section.rows).map(renderRow)}
          </div>
        </div>
      )}

      {error && (
        <div
          className={`rounded p-4 ${
            retriable
              ? "border-amber-200 bg-amber-50 text-amber-900"
              : "border-red-200 bg-red-50 text-red-900"
          }`}
        >
          {error}
          {retriable && (
            <p className="mt-1 text-sm">You can try again.</p>
          )}
        </div>
      )}

      {loadedAt && (
        <p className="text-xs text-zinc-500">
          Loaded {new Date(loadedAt).toLocaleString()}
        </p>
      )}

      <div className="sticky bottom-0 mt-8 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm" role="status" aria-live="polite" aria-atomic="true">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => handleSave(true)}
              disabled={saveState === "saving" || saveState === "saved"}
              className="rounded-md bg-[var(--wsu-crimson)] px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-[var(--wsu-crimson-hover)] disabled:opacity-50"
              title="Ctrl+Enter"
            >
              Save & Next
            </button>
            <button
              type="button"
              onClick={() => handleSave(false)}
              disabled={saveState === "saving" || saveState === "saved"}
              className="rounded-md border border-zinc-300 bg-white px-5 py-2.5 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 disabled:opacity-50"
            >
              {saveState === "saving"
                ? "Saving…"
                : saveState === "saved"
                  ? "Saved"
                  : "Save"}
            </button>
            <button
              type="button"
              onClick={loadRow}
              disabled={loading}
              className="rounded-md border border-zinc-200 px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 disabled:opacity-50"
            >
              Reload data
            </button>
            {saveState === "unsaved_changes" && (
              <span className="text-sm font-medium text-amber-600">Unsaved changes</span>
            )}
          </div>
          <Link
            href={`/reviewer/${cycleId}`}
            className="text-sm text-[var(--wsu-gray)] hover:text-[var(--wsu-crimson)] hover:underline"
          >
            ← All nominees
          </Link>
        </div>
      </div>
    </div>
  );
}
