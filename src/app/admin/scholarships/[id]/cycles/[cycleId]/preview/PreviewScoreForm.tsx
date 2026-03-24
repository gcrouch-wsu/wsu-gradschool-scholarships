"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { SavedLayoutJson } from "@/lib/layout";
import { bindFieldsToLayout, getBoundRowDesktopColumnCount } from "@/lib/layout-runtime";

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
  helperText?: string | null;
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
  const [attachments, setAttachments] = useState<{ id: string; name: string; url?: string; source?: string }[]>([]);
  const [showAttachments, setShowAttachments] = useState(false);
  const [attachmentHelpText, setAttachmentHelpText] = useState<string | null>(null);
  const [viewType, setViewType] = useState<string>("tabbed");
  const [viewSections, setViewSections] = useState<ViewSection[]>([]);
  const [activeTab, setActiveTab] = useState<string>("main");
  const [layoutJson, setLayoutJson] = useState<SavedLayoutJson | null>(null);
  const [colors, setColors] = useState<LayoutColors>(DEFAULT_COLORS);
  const [pinnedFieldKeys, setPinnedFieldKeys] = useState<string[]>([]);
  const [columnOptions, setColumnOptions] = useState<Record<number, string[]>>({});
  const [previewRoles, setPreviewRoles] = useState<{ id: string; label: string }[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string>("");

  const loadRow = useCallback(async () => {
    const base = `/api/admin/cycles/${cycleId}`;
    setLoading(true);
    setError(null);
    const roleParam = selectedRoleId ? `?roleId=${selectedRoleId}` : "";
    try {
      const [configRes, rowRes, rowsRes] = await Promise.all([
        fetch(`${base}/preview-config${roleParam}`),
        fetch(`${base}/preview-rows/${rowId}${roleParam}`),
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
        const attRes = await fetch(`${base}/preview-rows/${rowId}/attachments${roleParam}`);
        attachmentsData = attRes.ok ? await attRes.json() : { attachments: [] };
      }
      setShowAttachments(configData.showAttachments === true);
      setAttachmentHelpText(configData.attachmentHelpText ?? null);
      const fieldsData = rowData.fields ?? [];
      setFields(fieldsData);
      if (configData.roles?.length) {
        setPreviewRoles(configData.roles);
        if (!selectedRoleId && configData.activeRoleId) setSelectedRoleId(configData.activeRoleId);
      }
      const vType = configData.viewType ?? "tabbed";
      const vSections = configData.viewSections ?? [];
      setViewType(vType);
      setViewSections(vSections);
      if (vSections.length > 0) setActiveTab(vSections[0].section_key);
      setLayoutJson(configData.layoutJson ?? null);
      setColors({ ...DEFAULT_COLORS, ...(configData.colors ?? {}) });
      setPinnedFieldKeys(configData.pinnedFieldKeys ?? []);
      setColumnOptions(configData.columnOptions ?? {});
      const initial: Record<number, unknown> = {};
      for (const f of fieldsData) {
        initial[f.sourceColumnId] = f.value;
      }
      setEdits(initial);
      setNomineeIds((rowsData.rows ?? []).map((r: { id: number }) => r.id));
      setAttachments((attachmentsData.attachments ?? []).map(a => ({ ...a, id: String(a.id) })));
    } catch {
      setError("Failed to load");
    } finally {
      setLoading(false);
    }
  }, [cycleId, rowId, selectedRoleId]);

  useEffect(() => {
    loadRow();
  }, [loadRow]);

  const roleSelector = previewRoles.length > 1 ? (
    <div className="mb-4 flex items-center gap-2 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
      <span className="font-medium text-blue-800">Preview as:</span>
      <select
        value={selectedRoleId}
        onChange={(e) => setSelectedRoleId(e.target.value)}
        className="rounded border border-blue-300 bg-white px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400"
      >
        {previewRoles.map((r) => (
          <option key={r.id} value={r.id}>{r.label}</option>
        ))}
      </select>
      <span className="text-blue-600">— fields shown match live reviewer API for this role</span>
    </div>
  ) : null;

  if (loading) {
    return (
      <div className="mt-4">
        {roleSelector}
        <div className="mt-6 text-zinc-500">Loading…</div>
      </div>
    );
  }

  if (error && fields.length === 0) {
    return (
      <div className="mt-4">
        {roleSelector}
        <div className="mt-2 rounded border border-red-200 bg-red-50 p-4 text-red-900">
          {error}
        </div>
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

  function renderFieldContent(f: Field) {
    return (
      <div key={f.fieldKey}>
        <div className="text-xs font-medium text-zinc-500">{f.displayLabel}</div>
        {f.helperText && (
          <p className="mt-1 text-xs leading-5 text-zinc-500">{f.helperText}</p>
        )}
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
        {f.helperText && (
          <p className="mt-1 text-xs leading-5 text-zinc-500">{f.helperText}</p>
        )}
        {f.displayType === "score_select" ? (
          <select
            value={String(edits[f.sourceColumnId] ?? f.value ?? "")}
            onChange={(e) =>
              setEdits((prev) => ({ ...prev, [f.sourceColumnId]: e.target.value || null }))
            }
            className="mt-1 block w-full max-w-md rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
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
            onChange={(e) =>
              setEdits((prev) => ({ ...prev, [f.sourceColumnId]: e.target.value }))
            }
            rows={4}
            placeholder="Enter comments or recommendations..."
            className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
          />
        )}
      </div>
    );
  }

  function renderRow(row: { row_key: string; items: Array<{ field: Field; width: "full" | "half" | "third" }> }) {
    const desktopColumns = getBoundRowDesktopColumnCount(row);
    return (
      <div
        key={row.row_key}
        className={
          desktopColumns === 3
            ? "grid gap-3 md:grid-cols-3"
            : desktopColumns === 2
              ? "grid gap-3 md:grid-cols-2"
              : "space-y-3"
        }
      >
        {row.items.map(({ field }) =>
          field.canEdit ? renderEditableField(field) : renderFieldContent(field)
        )}
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-6">
      {roleSelector}
      <div className="rounded border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
        Preview mode — this is what reviewers see. No changes are saved.
      </div>

      {showAttachments && (
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="mb-3 font-medium text-zinc-900">Attachments</h2>
          {attachmentHelpText && (
            <p className="mb-3 text-sm leading-6 text-zinc-600">{attachmentHelpText}</p>
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
              <li className="text-sm text-zinc-500">No attachments for this nominee.</li>
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
              <div key={f.fieldKey}>
                <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
                  {f.displayLabel}
                </div>
                {f.helperText && (
                  <div className="mt-1 max-w-48 text-[11px] leading-4 text-zinc-500">
                    {f.helperText}
                  </div>
                )}
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
              {(layoutSections.find((section) => section.section_key === activeTab)?.rows ?? []).map(renderRow)}
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
                  <div className="space-y-3 border-t border-zinc-200 px-4 pb-4 pt-3">
                    {sectionRows.map(renderRow)}
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
                  <div className="space-y-3">
                    {sectionRows.map(renderRow)}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        <div className="rounded-lg border border-zinc-200 bg-white p-4">
          <div className="space-y-3">
            {layoutSections.flatMap((section) => section.rows).map(renderRow)}
          </div>
        </div>
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
