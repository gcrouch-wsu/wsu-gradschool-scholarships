"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * Purpose = how this field is used in the reviewer UI (app-layer concept).
 * Smartsheet column type (TEXT_NUMBER, PICKLIST, etc.) is the source of truth from the API.
 * This mapping defines which purposes are valid for each Smartsheet column type.
 * Extensible: add new purposes or type mappings as we build out more use cases.
 */
const PURPOSES = [
  { value: "identity", label: "Identity", desc: "Primary identifier (e.g. applicant name)" },
  { value: "subtitle", label: "Subtitle", desc: "Secondary identifier" },
  { value: "narrative", label: "Narrative", desc: "Essay or long text — read-only" },
  { value: "score", label: "Score", desc: "Reviewer picks from options — editable" },
  { value: "comments", label: "Comments", desc: "Reviewer writes free text — editable" },
  { value: "metadata", label: "Metadata", desc: "Other read-only info (dates, IDs, etc.)" },
  { value: "attachment", label: "Attachment", desc: "Row-level attachments" },
] as const;

/** Color-coded badges for each purpose — used in legend and field rows for visual consistency. */
const PURPOSE_STYLES: Record<string, string> = {
  identity: "bg-blue-100 text-blue-700",
  subtitle: "bg-blue-50 text-blue-600",
  narrative: "bg-violet-100 text-violet-700",
  score: "bg-amber-100 text-amber-700",
  comments: "bg-amber-50 text-amber-700",
  metadata: "bg-zinc-200 text-zinc-600",
  attachment: "bg-teal-100 text-teal-700",
};

/**
 * Map Smartsheet column type → purposes that make sense for that type.
 * Uses actual API types; no arbitrary types.
 * Optional `note` documents reasoning for future maintainers.
 */
const SMARTSHEET_TYPE_TO_PURPOSES: Record<string, { purposes: string[]; note?: string }> = {
  TEXT_NUMBER: { purposes: ["identity", "subtitle", "narrative", "score", "comments", "metadata"] },
  PICKLIST: {
    purposes: ["identity", "subtitle", "score", "metadata"],
    note: "Fixed-option columns map well to score fields",
  },
  MULTI_PICKLIST: { purposes: ["score", "metadata"] },
  CHECKBOX: { purposes: ["score", "metadata"] },
  CONTACT_LIST: { purposes: ["identity", "subtitle", "metadata"] },
  MULTI_CONTACT_LIST: { purposes: ["metadata"] },
  DATE: { purposes: ["identity", "subtitle", "metadata"] },
  DATETIME: { purposes: ["metadata"] },
  ABSTRACT_DATETIME: { purposes: ["metadata"] },
  DURATION: { purposes: ["metadata"] },
  PREDECESSOR: { purposes: ["metadata"] },
  attachment_list: { purposes: ["attachment"] },
};

function getPurposesForColumnType(colType: string): Array<(typeof PURPOSES)[number]> {
  const entry = SMARTSHEET_TYPE_TO_PURPOSES[colType];
  const allowed = entry?.purposes;
  if (!allowed?.length) {
    // Unknown type: restrict to metadata only rather than showing all options.
    return PURPOSES.filter((p) => p.value === "metadata");
  }
  return PURPOSES.filter((p) => allowed.includes(p.value));
}

/**
 * Maps purpose → display_type used in the reviewer UI.
 * When adding a new purpose:
 *   1. Add an entry here.
 *   2. Add the display_type value to validDisplayTypes in route.ts.
 *   3. Add a renderer for the display_type in the reviewer view component.
 */
const DISPLAY_TYPES: Record<string, string> = {
  identity: "header",
  subtitle: "short_text",
  narrative: "long_text",
  score: "score_select",
  comments: "textarea",
  metadata: "short_text",
  attachment: "attachment_list",
};

const LAYOUTS = [
  { value: "tabbed", label: "Tabbed review" },
  { value: "stacked", label: "Stacked sections" },
  { value: "accordion", label: "Accordion" },
  { value: "list_detail", label: "List and detail" },
];

interface Column {
  id: number;
  index: number;
  title: string;
  type: string;
  options?: string[];
  locked?: boolean;
}

interface FieldConfig {
  id: string;
  field_key: string;
  source_column_id: number;
  source_column_title: string;
  purpose: string;
  display_label: string;
  display_type: string;
  sort_order: number;
}

interface Role {
  id: string;
  key: string;
  label: string;
}

interface MappedField {
  sourceColumnId: number;
  sourceColumnTitle: string;
  purpose: string;
  displayLabel: string;
  displayType: string;
  sortOrder: number;
  fieldKey: string;
  sectionKey?: string;
  permissions?: Array<{ roleId: string; canView: boolean; canEdit: boolean }>;
}

interface ViewSection {
  id?: string;
  section_key: string;
  label: string;
  sort_order: number;
}

/** Preview of reviewer layout — reacts to viewType and has working dropdowns */
function LayoutPreview({
  mapped,
  viewType,
  columns,
  sections,
}: {
  mapped: MappedField[];
  viewType: string;
  columns: Column[];
  sections: ViewSection[];
}) {
  const [previewValues, setPreviewValues] = useState<Record<string, string>>({});
  const tabList = sections.length > 0
    ? sections
    : [
        { section_key: "narrative", label: "Narrative & details", sort_order: 0 },
        { section_key: "scores", label: "Scores & comments", sort_order: 1 },
      ];
  const [activeTab, setActiveTab] = useState(tabList[0]?.section_key ?? "narrative");

  function getOptionsForField(m: MappedField): string[] {
    const col = columns.find((c) => c.id === m.sourceColumnId);
    return col?.options ?? [];
  }

  if (mapped.length === 0) {
    return <p className="text-sm text-zinc-500">No fields mapped yet.</p>;
  }

  const fieldsBySection = tabList.reduce((acc, s) => {
    acc[s.section_key] = mapped.filter((m) => (m.sectionKey || tabList[0]?.section_key) === s.section_key);
    return acc;
  }, {} as Record<string, MappedField[]>);
  const readOnlyFields = mapped.filter((m) => m.purpose !== "score" && m.purpose !== "comments");
  const editableFields = mapped.filter((m) => m.purpose === "score" || m.purpose === "comments");

  function renderField(m: MappedField) {
    const options = getOptionsForField(m);
    return (
      <div key={m.fieldKey} className="border-b border-zinc-100 pb-2 last:border-0">
        <span className="text-xs text-zinc-500 uppercase">{m.purpose}</span>
        <div className="font-medium">{m.displayLabel}</div>
        {m.purpose === "score" && (
          <select
            value={previewValues[m.fieldKey] ?? ""}
            onChange={(e) => setPreviewValues((prev) => ({ ...prev, [m.fieldKey]: e.target.value }))}
            className="mt-1 rounded border border-zinc-300 px-2 py-1 text-sm"
          >
            <option value="">— Select —</option>
            {options.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        )}
        {m.purpose === "comments" && (
          <textarea
            readOnly
            placeholder="Comments..."
            className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 text-sm"
            rows={2}
          />
        )}
      </div>
    );
  }

  if (viewType === "tabbed") {
    const activeFields = fieldsBySection[activeTab] ?? [];
    return (
      <div className="rounded border border-zinc-200 bg-white">
        <div className="flex border-b border-zinc-200">
          {tabList.map((s) => (
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
          {activeFields.length > 0 ? (
            <div className="space-y-2">{activeFields.map(renderField)}</div>
          ) : (
            <p className="text-sm text-zinc-500">No fields in this tab</p>
          )}
        </div>
      </div>
    );
  }

  if (viewType === "accordion") {
    return (
      <div className="space-y-2">
        <details open className="rounded border border-zinc-200 bg-white">
          <summary className="cursor-pointer px-4 py-2 font-medium text-zinc-900">
            Narrative & details
          </summary>
          <div className="space-y-2 border-t border-zinc-200 px-4 pb-4 pt-2">
            {readOnlyFields.map(renderField)}
          </div>
        </details>
        {editableFields.length > 0 && (
          <details className="rounded border border-zinc-200 bg-white">
            <summary className="cursor-pointer px-4 py-2 font-medium text-zinc-900">
              Scores & comments
            </summary>
            <div className="space-y-2 border-t border-zinc-200 px-4 pb-4 pt-2">
              {editableFields.map(renderField)}
            </div>
          </details>
        )}
      </div>
    );
  }

  if (viewType === "list_detail") {
    return (
      <div className="flex gap-4">
        <div className="w-48 shrink-0 rounded border border-zinc-200 bg-zinc-50 p-2">
          <div className="text-xs font-medium uppercase text-zinc-500">Nominees</div>
          <div className="mt-2 text-sm text-zinc-600">Sample nominee</div>
        </div>
        <div className="min-w-0 flex-1 space-y-2 rounded border border-zinc-200 bg-white p-4">
          {mapped.map(renderField)}
        </div>
      </div>
    );
  }

  // stacked (default)
  return (
    <div className="space-y-4">
      {readOnlyFields.length > 0 && (
        <div className="rounded border border-zinc-200 bg-white p-4">
          <div className="mb-2 text-sm font-medium text-zinc-900">Narrative & details</div>
          <div className="space-y-2">{readOnlyFields.map(renderField)}</div>
        </div>
      )}
      {editableFields.length > 0 && (
        <div className="rounded border border-zinc-200 bg-white p-4">
          <div className="mb-2 text-sm font-medium text-zinc-900">Scores & comments</div>
          <div className="space-y-2">{editableFields.map(renderField)}</div>
        </div>
      )}
    </div>
  );
}

export function FieldMappingBuilder({
  programId,
  cycleId,
}: {
  programId: string;
  cycleId: string;
}) {
  const router = useRouter();
  const [data, setData] = useState<{
    columns: Column[];
    fieldConfigs: FieldConfig[];
    roles: Role[];
    viewConfigs: { view_type: string }[];
    viewSections?: ViewSection[];
    sectionFields?: Array<{ view_section_id: string; field_config_id: string; sort_order: number }>;
  } | null>(null);
  const [mapped, setMapped] = useState<MappedField[]>([]);
  const [sections, setSections] = useState<ViewSection[]>([]);
  const [viewType, setViewType] = useState("tabbed");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/admin/cycles/${cycleId}/builder`)
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        if (d.viewConfigs?.[0]) {
          setViewType(d.viewConfigs[0].view_type);
        }
        if (d.viewSections?.length > 0) {
          setSections(
            d.viewSections
              .sort((a: ViewSection, b: ViewSection) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
              .map((vs: { id?: string; section_key: string; label: string; sort_order: number }) => ({
                id: vs.id,
                section_key: vs.section_key,
                label: vs.label,
                sort_order: vs.sort_order,
              }))
          );
        } else {
          setSections([
            { section_key: "narrative", label: "Narrative & details", sort_order: 0 },
            { section_key: "scores", label: "Scores & comments", sort_order: 1 },
          ]);
        }
        if (d.fieldConfigs?.length > 0) {
          const permsByField = (d.permissions ?? []).reduce(
            (acc: Record<string, Array<{ roleId: string; canView: boolean; canEdit: boolean }>>, p: { field_config_id: string; role_id: string; can_view: boolean; can_edit: boolean }) => {
              if (!acc[p.field_config_id]) acc[p.field_config_id] = [];
              acc[p.field_config_id].push({
                roleId: p.role_id,
                canView: p.can_view,
                canEdit: p.can_edit,
              });
              return acc;
            },
            {}
          );
          const sectionByFieldId = (d.sectionFields ?? []).reduce(
            (acc: Record<string, string>, sf: { view_section_id: string; field_config_id: string }) => {
              const vs = (d.viewSections ?? []).find((s: ViewSection) => s.id === sf.view_section_id);
              if (vs) acc[sf.field_config_id] = vs.section_key;
              return acc;
            },
            {}
          );
          setMapped(
            d.fieldConfigs.map((fc: FieldConfig) => ({
              sourceColumnId: fc.source_column_id,
              sourceColumnTitle: fc.source_column_title,
              purpose: fc.purpose,
              displayLabel: fc.display_label,
              displayType: fc.display_type,
              sortOrder: fc.sort_order,
              fieldKey: fc.field_key,
              sectionKey: sectionByFieldId[fc.id],
              permissions: permsByField[fc.id],
            }))
          );
        } else if (d.columns?.length > 0) {
          setMapped([]);
        }
      })
      .catch(() => setError("Failed to load builder data"))
      .finally(() => setLoading(false));
  }, [cycleId]);

  function addColumn(col: Column) {
    const key = `col_${col.id}`;
    if (mapped.some((m) => m.sourceColumnId === col.id)) return;
    const isAttachment = col.id === 0;
    const colType = isAttachment ? "attachment_list" : col.type;
    const purposes = getPurposesForColumnType(colType);
    const defaultPurpose = isAttachment ? "attachment" : (purposes[0]?.value ?? "metadata");
    const defaultPerms = (data?.roles ?? []).map((r) => ({
      roleId: r.id,
      canView: true,
      canEdit: false,
    }));
    const defaultSection = sections.length > 0 ? sections[0]?.section_key : undefined;
    setMapped((prev) => [
      ...prev,
      {
        sourceColumnId: col.id,
        sourceColumnTitle: col.title,
        purpose: defaultPurpose,
        displayLabel: col.title,
        displayType: isAttachment ? "attachment_list" : DISPLAY_TYPES[defaultPurpose] ?? "short_text",
        sortOrder: prev.length,
        fieldKey: key,
        sectionKey: defaultSection,
        permissions: defaultPerms,
      },
    ]);
  }

  function addSection() {
    const n = sections.length;
    const section_key = `section_${n}`;
    setSections((prev) => [
      ...prev,
      { section_key, label: `Tab ${n + 1}`, sort_order: n },
    ]);
  }

  function updateSection(idx: number, updates: Partial<ViewSection>) {
    setSections((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, ...updates } : s))
    );
  }

  function removeSection(idx: number) {
    const removed = sections[idx];
    if (!removed) return;
    const fallback = sections.find((_, i) => i !== idx);
    setSections((prev) => prev.filter((_, i) => i !== idx));
    if (fallback) {
      setMapped((prev) =>
        prev.map((m) =>
          m.sectionKey === removed.section_key
            ? { ...m, sectionKey: fallback.section_key }
            : m
        )
      );
    }
  }

  function removeMapping(idx: number) {
    setMapped((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateMapping(idx: number, updates: Partial<MappedField>) {
    setMapped((prev) =>
      prev.map((m, i) => (i === idx ? { ...m, ...updates } : m))
    );
  }

  function ensurePermissions(m: MappedField): MappedField {
    if (m.permissions?.length) return m;
    const roles = data?.roles ?? [];
    const canEdit = m.purpose === "score" || m.purpose === "comments";
    return {
      ...m,
      permissions: roles.map((r) => ({
        roleId: r.id,
        canView: true,
        canEdit,
      })),
    };
  }

  async function handleSave() {
    setError("");
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/cycles/${cycleId}/builder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fieldConfigs: mapped.map((m, i) => {
            const ensured = ensurePermissions(m);
            return {
              fieldKey: m.fieldKey,
              sourceColumnId: m.sourceColumnId,
              sourceColumnTitle: m.sourceColumnTitle,
              purpose: m.purpose,
              displayLabel: m.displayLabel,
              displayType: DISPLAY_TYPES[m.purpose] || m.displayType,
              sortOrder: i,
              sectionKey: m.sectionKey ?? sections[0]?.section_key,
              permissions: ensured.permissions,
            };
          }),
          viewType,
          sections: viewType === "tabbed" && sections.length > 0
            ? sections.map((s, i) => ({ section_key: s.section_key, label: s.label, sort_order: s.sort_order ?? i }))
            : undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? "Failed to save");
        return;
      }
      router.refresh();
    } catch {
      setError("An error occurred");
    } finally {
      setSaving(false);
    }
  }

  if (loading || !data) {
    return <div className="mt-6 text-zinc-500">Loading…</div>;
  }

  const columns = data.columns ?? [];
  const unmappedColumns = columns.filter(
    (c) => !mapped.some((m) => m.sourceColumnId === c.id)
  );

  return (
    <div className="mt-6 space-y-6">
      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="mb-3 font-medium text-zinc-900">1. Map columns to purpose</h2>
        <p className="mb-4 text-sm text-zinc-600">
          Add columns and assign each a purpose. Column type (e.g. TEXT_NUMBER, PICKLIST) comes from Smartsheet — we use the actual API types. Purpose is how we use it in the reviewer UI; the dropdown shows only purposes valid for that column type. Locked columns cannot be edited — avoid Score or Comments.
        </p>

        <div className="mb-4">
          <div className="mb-1 text-xs text-zinc-500">
            Click a column to add it. Unmapped columns are shown below.
          </div>
          <div className="flex flex-wrap gap-2">
            {unmappedColumns.map((col) => (
              <button
                key={col.id}
                type="button"
                onClick={() => addColumn(col)}
                className="flex items-center gap-1.5 rounded border border-zinc-300 px-2.5 py-1.5 text-sm hover:border-zinc-400 hover:bg-zinc-50"
              >
                <span>+ {col.title}</span>
                <span className="rounded bg-zinc-100 px-1 py-0.5 text-[10px] font-mono text-zinc-500">
                  {col.type}
                </span>
                {col.locked && (
                  <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-700">
                    locked
                  </span>
                )}
              </button>
            ))}
            {unmappedColumns.length === 0 && columns.length > 0 && (
              <span className="text-sm text-zinc-500">All columns mapped</span>
            )}
          </div>
        </div>

        <div className="mb-4 rounded-lg border border-zinc-100 bg-zinc-50 p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Purpose reference
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-4">
            {PURPOSES.map((p) => (
              <div key={p.value} className="flex items-start gap-1.5">
                <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${PURPOSE_STYLES[p.value] ?? "bg-zinc-100 text-zinc-500"}`}>
                  {p.label}
                </span>
                <span className="text-xs text-zinc-500">{p.desc}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-zinc-400">
            Available purposes are filtered by each column&apos;s Smartsheet type.
            Hover any purpose dropdown to see why options may be limited.
          </p>
        </div>

        <p className="mb-2 text-xs text-zinc-500">
          Drag to reorder. Order determines display in reviewer layout.
        </p>
        <div className="space-y-2">
          <div
            className="grid gap-3 rounded border-b border-zinc-200 pb-2 text-xs font-medium uppercase tracking-wide text-zinc-500"
            style={{
              gridTemplateColumns: viewType === "tabbed"
                ? "20px minmax(120px,1fr) minmax(70px,1fr) minmax(100px,1fr) minmax(120px,1.5fr) minmax(100px,1fr) auto"
                : "20px minmax(120px,1fr) minmax(70px,1fr) minmax(100px,1fr) minmax(120px,1.5fr) auto",
            }}
          >
            <span className="w-5" aria-hidden />
            <span>Column</span>
            <span>Type</span>
            <span>Purpose</span>
            <span>Display label</span>
            {viewType === "tabbed" && <span>Tab</span>}
            <span />
          </div>
          {mapped.map((m, idx) => {
            const col = columns.find((c) => c.id === m.sourceColumnId);
            const colType = col?.type ?? "—";
            const colLocked = col?.locked ?? false;
            const isEditablePurpose = m.purpose === "score" || m.purpose === "comments";
            const lockedConflict = colLocked && isEditablePurpose;
            const gridCols = viewType === "tabbed"
              ? "20px minmax(120px,1fr) minmax(70px,1fr) minmax(100px,1fr) minmax(120px,1.5fr) minmax(100px,1fr) auto"
              : "20px minmax(120px,1fr) minmax(70px,1fr) minmax(100px,1fr) minmax(120px,1.5fr) auto";
            return (
              <div
                key={m.fieldKey}
                className={`grid gap-3 items-center rounded border p-3 ${lockedConflict ? "border-amber-300 bg-amber-50/50" : "border-zinc-200 bg-zinc-50"}`}
                style={{ gridTemplateColumns: gridCols }}
              >
                {lockedConflict && (
                  <div className="col-span-full -mt-1 mb-1 flex items-center gap-1.5 rounded bg-amber-100 px-2 py-1 text-xs text-amber-800">
                    <span>⚠</span>
                    <span>
                      Locked column — write conflicts will occur if used as Score or Comments.
                      Change purpose or unlock in Smartsheet.
                    </span>
                  </div>
                )}
                <div
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", String(idx));
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const fromIdx = parseInt(e.dataTransfer.getData("text/plain"), 10);
                    if (fromIdx === idx || isNaN(fromIdx)) return;
                    setMapped((prev) => {
                      const next = [...prev];
                      const [removed] = next.splice(fromIdx, 1);
                      next.splice(idx, 0, removed);
                      return next;
                    });
                  }}
                  className="flex w-5 shrink-0 cursor-grab items-center justify-center text-zinc-300 hover:text-zinc-500 active:cursor-grabbing"
                  title="Drag to reorder"
                  aria-hidden
                >
                  ⠿
                </div>
                <div className="min-w-0">
                  <span className="font-medium text-zinc-700">{m.sourceColumnTitle}</span>
                  {colLocked && !lockedConflict && (
                    <span className="ml-1 rounded bg-amber-200 px-1.5 py-0.5 text-[10px] text-amber-800" title="Column is locked in Smartsheet">
                      Locked
                    </span>
                  )}
                </div>
                <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-mono text-zinc-600" title="Smartsheet column type">
                  {colType}
                </span>
                <div className="flex flex-col gap-1">
                  <span className={`self-start rounded px-1.5 py-0.5 text-[10px] font-medium ${PURPOSE_STYLES[m.purpose] ?? "bg-zinc-100 text-zinc-500"}`}>
                    {PURPOSES.find((p) => p.value === m.purpose)?.label ?? m.purpose}
                  </span>
                  <select
                    value={m.purpose}
                    onChange={(e) =>
                      updateMapping(idx, {
                        purpose: e.target.value,
                        displayType: DISPLAY_TYPES[e.target.value] || m.displayType,
                      })
                    }
                    className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
                    title={PURPOSES.find((p) => p.value === m.purpose)?.desc}
                  >
                    {(() => {
                      const options = getPurposesForColumnType(colType);
                      const current = PURPOSES.find((p) => p.value === m.purpose);
                      const currentIncluded = options.some((p) => p.value === m.purpose);
                      const toShow = currentIncluded ? options : current ? [...options, current] : options;
                      return toShow.map((p) => (
                        <option key={p.value} value={p.value} title={p.desc}>
                          {p.label}
                        </option>
                      ));
                    })()}
                  </select>
                </div>
                <input
                  type="text"
                  value={m.displayLabel}
                  onChange={(e) => updateMapping(idx, { displayLabel: e.target.value })}
                  placeholder="Display label"
                  className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
                />
                {viewType === "tabbed" && (
                  <select
                    value={m.sectionKey ?? sections[0]?.section_key ?? ""}
                    onChange={(e) => updateMapping(idx, { sectionKey: e.target.value })}
                    className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
                  >
                    {sections.map((s) => (
                      <option key={s.section_key} value={s.section_key}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={() => removeMapping(idx)}
                  className="text-sm text-red-600 hover:underline justify-self-end"
                >
                  Remove
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {viewType === "tabbed" && (
        <section className="rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="mb-1 font-medium text-zinc-900">1b. Tabs</h2>
          <p className="mb-3 text-sm text-zinc-600">
            Create tabs and assign fields using the Tab column in the field table above.
          </p>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-zinc-700">Tabs</span>
            <button
              type="button"
              onClick={addSection}
              className="rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
            >
              + Add tab
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {sections.map((s, i) => (
              <div key={s.section_key} className="flex items-center gap-1 rounded border border-zinc-200 bg-white px-2 py-1">
                <input
                  type="text"
                  value={s.label}
                  onChange={(e) => updateSection(i, { label: e.target.value })}
                  className="w-32 rounded border-0 bg-transparent px-1 py-0.5 text-sm focus:ring-1 focus:ring-zinc-400"
                  placeholder="Tab label"
                />
                {sections.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeSection(i)}
                    className="text-xs text-red-600 hover:text-red-700"
                    title="Remove tab"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="mb-3 font-medium text-zinc-900">2. Role visibility</h2>
        <p className="mb-3 text-sm text-zinc-600">
          By default, all roles can view all fields. Score and comments fields are editable by reviewers.
        </p>
        {data.roles?.length > 0 && mapped.some((m) => m.purpose === "score" || m.purpose === "comments") && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200">
                  <th className="py-2 text-left font-medium text-zinc-700">Field</th>
                  {data.roles.map((r) => (
                    <th key={r.id} className="px-2 py-2 text-left font-medium text-zinc-700">
                      {r.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mapped
                  .filter((m) => m.purpose === "score" || m.purpose === "comments")
                  .map((m) => (
                    <tr key={m.fieldKey} className="border-b border-zinc-100">
                      <td className="py-2">{m.displayLabel}</td>
                      {data.roles!.map((r) => {
                        const perm = m.permissions?.find((p) => p.roleId === r.id);
                        const canEdit = perm?.canEdit ?? (m.purpose === "score" || m.purpose === "comments");
                        return (
                          <td key={r.id} className="px-2 py-2">
                            <label className="flex items-center gap-1">
                              <input
                                type="checkbox"
                                checked={perm?.canView ?? true}
                                onChange={(e) => {
                                  const idx = mapped.findIndex((x) => x.fieldKey === m.fieldKey);
                                  const perms = [...(m.permissions ?? [])];
                                  const pi = perms.findIndex((p) => p.roleId === r.id);
                                  if (pi >= 0) {
                                    perms[pi] = { ...perms[pi], canView: e.target.checked };
                                  } else {
                                    perms.push({
                                      roleId: r.id,
                                      canView: e.target.checked,
                                      canEdit: m.purpose === "score" || m.purpose === "comments",
                                    });
                                  }
                                  updateMapping(idx, { permissions: perms });
                                }}
                              />
                              <span className="text-xs">view</span>
                            </label>
                            {(m.purpose === "score" || m.purpose === "comments") && (
                              <label className="mt-1 flex items-center gap-1">
                                <input
                                  type="checkbox"
                                  checked={canEdit}
                                  onChange={(e) => {
                                    const idx = mapped.findIndex((x) => x.fieldKey === m.fieldKey);
                                    const perms = [...(m.permissions ?? ensurePermissions(m).permissions ?? [])];
                                    const pi = perms.findIndex((p) => p.roleId === r.id);
                                    if (pi >= 0) {
                                      perms[pi] = { ...perms[pi], canEdit: e.target.checked };
                                    } else {
                                      perms.push({
                                        roleId: r.id,
                                        canView: true,
                                        canEdit: e.target.checked,
                                      });
                                    }
                                    updateMapping(idx, { permissions: perms });
                                  }}
                                />
                                <span className="text-xs">edit</span>
                              </label>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="mb-3 font-medium text-zinc-900">3. Layout template</h2>
        <p className="mb-3 text-sm text-zinc-600">
          How the reviewer form is organized. The preview below updates when you change this.
        </p>
        <div className="flex flex-wrap gap-3">
          {LAYOUTS.map((l) => (
            <label
              key={l.value}
              className={`flex cursor-pointer items-center gap-2 rounded-lg border-2 px-4 py-2 transition-colors ${
                viewType === l.value
                  ? "border-zinc-900 bg-zinc-50"
                  : "border-zinc-200 bg-white hover:border-zinc-300"
              }`}
            >
              <input
                type="radio"
                name="layout"
                value={l.value}
                checked={viewType === l.value}
                onChange={() => setViewType(l.value)}
                className="sr-only"
              />
              <span className="text-sm font-medium">{l.label}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <h2 className="mb-2 font-medium text-zinc-900">4. Preview</h2>
        <p className="mb-3 text-sm text-zinc-600">
          Preview updates when you change the layout template. Score dropdowns show options from the Smartsheet column.
        </p>
        <LayoutPreview mapped={mapped} viewType={viewType} columns={columns} sections={sections} />
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded bg-[var(--wsu-crimson)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--wsu-crimson-hover)] disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save configuration"}
        </button>
        <Link
          href={`/admin/scholarships/${programId}/cycles/${cycleId}`}
          className="rounded border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          Back to cycle
        </Link>
      </div>
    </div>
  );
}
