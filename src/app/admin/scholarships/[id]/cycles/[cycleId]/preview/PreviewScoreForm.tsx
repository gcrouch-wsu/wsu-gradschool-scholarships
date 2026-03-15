"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

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

export function PreviewScoreForm({
  cycleId,
  rowId,
  programId,
  cycleLabel,
}: {
  cycleId: string;
  rowId: number;
  programId: string;
  cycleLabel: string;
}) {
  const [fields, setFields] = useState<Field[]>([]);
  const [edits, setEdits] = useState<Record<number, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nomineeIds, setNomineeIds] = useState<number[]>([]);
  const [attachments, setAttachments] = useState<{ id: number; name: string; url?: string }[]>([]);
  const [viewType, setViewType] = useState<string>("tabbed");
  const [viewSections, setViewSections] = useState<ViewSection[]>([]);
  const [activeTab, setActiveTab] = useState<string>("main");

  const loadRow = useCallback(async () => {
    const base = `/api/admin/cycles/${cycleId}`;
    setLoading(true);
    setError(null);
    try {
      const [configRes, rowRes, rowsRes] = await Promise.all([
        fetch(`${base}/preview-config`),
        fetch(`${base}/preview-rows/${rowId}`),
        fetch(`${base}/preview-rows`),
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
      let attachmentsData: { attachments: { id: number; name: string; url?: string }[] } = {
        attachments: [],
      };
      if (configData.showAttachments === true) {
        const attRes = await fetch(`${base}/preview-rows/${rowId}/attachments`);
        attachmentsData = attRes.ok ? await attRes.json() : { attachments: [] };
      }
      const fieldsData = rowData.fields ?? [];
      setFields(fieldsData);
      const vType = configData.viewType ?? "tabbed";
      const vSections = configData.viewSections ?? [];
      setViewType(vType);
      setViewSections(vSections);
      if (vSections.length > 0) setActiveTab(vSections[0].section_key);
      const initial: Record<number, unknown> = {};
      for (const f of fieldsData) {
        initial[f.sourceColumnId] = f.value;
      }
      setEdits(initial);
      setNomineeIds((rowsData.rows ?? []).map((r: { id: number }) => r.id));
      setAttachments(attachmentsData.attachments ?? []);
    } catch {
      setError("Failed to load");
    } finally {
      setLoading(false);
    }
  }, [cycleId, rowId]);

  useEffect(() => {
    loadRow();
  }, [loadRow]);

  if (loading) {
    return <div className="mt-6 text-zinc-500">Loading…</div>;
  }

  if (error && fields.length === 0) {
    return (
      <div className="mt-6 rounded border border-red-200 bg-red-50 p-4 text-red-900">
        {error}
      </div>
    );
  }

  const editableFields = fields.filter((f) => f.canEdit);
  const readOnlyFields = fields.filter((f) => !f.canEdit);
  const sections = viewSections.length > 0
    ? viewSections
    : [
        { section_key: "narrative", label: "Narrative & details", sort_order: 0 },
        { section_key: "scores", label: "Scores & comments", sort_order: 1 },
      ];
  const useTabs = viewType === "tabbed" && sections.length > 0;
  const fieldsBySection = sections.reduce((acc, s) => {
    acc[s.section_key] = fields.filter((f) => (f.sectionKey ?? "main") === s.section_key);
    return acc;
  }, {} as Record<string, Field[]>);

  function renderFieldContent(f: Field) {
    return (
      <div key={f.fieldKey}>
        <div className="text-xs font-medium text-zinc-500">{f.displayLabel}</div>
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
          <div className="mt-1 text-zinc-600">
            {String(edits[f.sourceColumnId] ?? f.value ?? "—")}
          </div>
        ) : (
          <div className="mt-1 whitespace-pre-wrap text-zinc-600">
            {String(edits[f.sourceColumnId] ?? f.value ?? "") || "—"}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-6">
      <div className="rounded border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
        Preview mode — this is what reviewers see. No changes are saved.
      </div>

      {attachments.length > 0 && (
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="mb-3 font-medium text-zinc-900">Attachments</h2>
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
          </ul>
        </div>
      )}

      {useTabs ? (
        <div className="rounded-lg border border-zinc-200 bg-white">
          <div className="flex border-b border-zinc-200">
            {sections.map((s) => (
              <button
                key={s.section_key}
                type="button"
                onClick={() => setActiveTab(s.section_key)}
                className={`rounded-t px-4 py-2 text-sm font-medium ${
                  activeTab === s.section_key
                    ? "border-b-2 border-zinc-900 bg-white text-zinc-900 -mb-px"
                    : "bg-zinc-50 text-zinc-500 hover:text-zinc-700"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="p-4">
            {(fieldsBySection[activeTab] ?? []).map((f) =>
              f.canEdit ? renderEditableField(f) : renderFieldContent(f)
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <h2 className="mb-3 font-medium text-zinc-900">Narrative & details</h2>
            <div className="space-y-3">{readOnlyFields.map(renderFieldContent)}</div>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <h2 className="mb-3 font-medium text-zinc-900">Scores & comments (editable by reviewer)</h2>
            <div className="space-y-4">{editableFields.map(renderEditableField)}</div>
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {nomineeIds.length > 0 && (
          <div className="flex gap-2">
            {nomineeIds.indexOf(rowId) > 0 && (
              <Link
                href={`/admin/scholarships/${programId}/cycles/${cycleId}/preview?row=${nomineeIds[nomineeIds.indexOf(rowId) - 1]}`}
                className="rounded border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50"
              >
                ← Previous
              </Link>
            )}
            {nomineeIds.indexOf(rowId) >= 0 && nomineeIds.indexOf(rowId) < nomineeIds.length - 1 && (
              <Link
                href={`/admin/scholarships/${programId}/cycles/${cycleId}/preview?row=${nomineeIds[nomineeIds.indexOf(rowId) + 1]}`}
                className="rounded border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50"
              >
                Next →
              </Link>
            )}
          </div>
        )}
        <Link
          href={`/admin/scholarships/${programId}/cycles/${cycleId}/preview`}
          className="text-sm text-zinc-600 hover:underline"
        >
          Back to list
        </Link>
        <Link
          href={`/admin/scholarships/${programId}/cycles/${cycleId}`}
          className="text-sm text-zinc-600 hover:underline"
        >
          ← {cycleLabel}
        </Link>
      </div>
    </div>
  );
}
