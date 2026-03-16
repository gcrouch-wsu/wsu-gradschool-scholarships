"use client";

import React, { useEffect, useRef, useState } from "react";
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
  // When type is missing/unknown ("—"), use TEXT_NUMBER so user can switch between identity, metadata, etc.
  const effectiveType = !colType || colType === "—" ? "TEXT_NUMBER" : colType;
  const entry = SMARTSHEET_TYPE_TO_PURPOSES[effectiveType];
  const allowed = entry?.purposes;
  if (!allowed?.length) {
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

type PurposeOverride = { label?: string; desc?: string; editable?: boolean };

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

/** WSU brand palette — mirrors wsu-gradschool-tools newsletter editor */
const WSU_COLORS = [
  { name: "Crimson", value: "#A60F2D" },
  { name: "Dark Crimson", value: "#8c0d25" },
  { name: "Gray", value: "#4D4D4D" },
  { name: "Light Gray", value: "#5E6A71" },
  { name: "Text Dark", value: "#2A3033" },
  { name: "Text Body", value: "#333333" },
  { name: "Muted", value: "#cccccc" },
  { name: "Bg Light", value: "#f4f4f4" },
  { name: "Bg Card", value: "#f9f9f9" },
  { name: "White", value: "#ffffff" },
  { name: "Black", value: "#000000" },
  { name: "Border", value: "#e0e0e0" },
];

interface LayoutColors {
  accent: string;     // active tab indicator, focus rings, primary button
  headerBg: string;   // identity/header card background
  headerText: string; // identity/header card text
  cardBg: string;     // content card background
}

const DEFAULT_COLORS: LayoutColors = {
  accent: "#A60F2D",    // WSU Crimson
  headerBg: "#ffffff",
  headerText: "#171717",
  cardBg: "#ffffff",
};

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
  pinned?: boolean;
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
  colors,
}: {
  mapped: MappedField[];
  viewType: string;
  columns: Column[];
  sections: ViewSection[];
  colors: LayoutColors;
}) {
  const [previewValues, setPreviewValues] = useState<Record<string, string>>({});
  const tabList = sections.length > 0
    ? sections
    : [
        { section_key: "main", label: "Review", sort_order: 0 },
      ];
  const [activeTab, setActiveTab] = useState(tabList[0]?.section_key ?? "main");

  function getOptionsForField(m: MappedField): string[] {
    const col = columns.find((c) => c.id === m.sourceColumnId);
    return col?.options ?? [];
  }

  if (mapped.length === 0) {
    return <p className="text-sm text-zinc-500">No fields mapped yet.</p>;
  }

  const pinnedFields = mapped.filter((m) => m.pinned);
  const unpinned = mapped.filter((m) => !m.pinned);

  const fieldsBySection = tabList.reduce((acc, s) => {
    acc[s.section_key] = unpinned.filter((m) => (m.sectionKey || tabList[0]?.section_key) === s.section_key);
    return acc;
  }, {} as Record<string, MappedField[]>);

  const PinnedCard = pinnedFields.length > 0 ? (
    <div
      className="mb-3 rounded-lg border border-zinc-200 px-4 py-3"
      style={{ backgroundColor: colors.headerBg }}
    >
      <div className="flex flex-wrap gap-x-8 gap-y-1.5">
        {pinnedFields.map((m) => (
          <div key={m.fieldKey}>
            <span className="block text-[10px] uppercase tracking-wide text-zinc-400">{m.displayLabel}</span>
            <span className="text-sm font-semibold" style={{ color: colors.headerText }}>
              Sample {m.sourceColumnTitle}
            </span>
          </div>
        ))}
      </div>
    </div>
  ) : null;

  function renderField(m: MappedField) {
    const options = getOptionsForField(m);
    return (
      <div key={m.fieldKey} className="border-b border-zinc-100 pb-3 last:border-0">
        <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">{m.displayLabel}</span>
        {m.purpose === "identity" && (
          <div className="mt-0.5 text-xl font-semibold" style={{ color: colors.headerText }}>
            Sample Applicant Name
          </div>
        )}
        {m.purpose === "subtitle" && (
          <div className="mt-0.5 text-sm text-zinc-600">Sample subtitle value</div>
        )}
        {m.purpose === "narrative" && (
          <div className="mt-1 space-y-1 text-sm text-zinc-700">
            <p>This is where the applicant&apos;s narrative or essay response will appear.</p>
            <p className="text-zinc-400">Reviewers see the full text here in read-only format.</p>
          </div>
        )}
        {m.purpose === "metadata" && (
          <div className="mt-0.5 text-sm text-zinc-600">— sample value —</div>
        )}
        {m.purpose === "score" && (
          <div>
            <select
              value={previewValues[m.fieldKey] ?? ""}
              onChange={(e) => setPreviewValues((prev) => ({ ...prev, [m.fieldKey]: e.target.value }))}
              className="mt-1 rounded border border-zinc-300 px-2 py-1 text-sm"
              style={{ accentColor: colors.accent }}
            >
              <option value="">— Select —</option>
              {options.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
            {options.length === 0 && (
              <p className="mt-1 text-[11px] text-amber-600">
                No options found. Re-import the sheet schema if this PICKLIST column has options in Smartsheet.
              </p>
            )}
          </div>
        )}
        {m.purpose === "comments" && (
          <textarea
            readOnly
            placeholder="Reviewer comments will appear here..."
            className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 text-sm text-zinc-400"
            rows={2}
          />
        )}
        {m.purpose === "attachment" && (
          <div className="mt-1 flex items-center gap-1.5 text-sm text-zinc-500">
            <span>📎</span>
            <span>attachment-sample.pdf</span>
          </div>
        )}
      </div>
    );
  }

  if (viewType === "tabbed") {
    const activeFields = fieldsBySection[activeTab] ?? [];
    return (
      <div>
      {PinnedCard}
      <div className="rounded border border-zinc-200" style={{ backgroundColor: colors.cardBg }}>
        <div className="flex border-b border-zinc-200">
          {tabList.map((s) => {
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
          {activeFields.length > 0 ? (
            <div className="space-y-3">{activeFields.map(renderField)}</div>
          ) : (
            <p className="text-sm text-zinc-500">No fields in this tab</p>
          )}
        </div>
      </div>
      </div>
    );
  }

  if (viewType === "accordion") {
    return (
      <div>
      {PinnedCard}
      <div className="space-y-2">
        {tabList.map((s) => {
          const sectionFields = fieldsBySection[s.section_key] ?? [];
          return (
            <details key={s.section_key} className="rounded border border-zinc-200 bg-white">
              <summary className="cursor-pointer px-4 py-2 font-medium text-zinc-900">
                {s.label}
              </summary>
              <div className="space-y-2 border-t border-zinc-200 px-4 pb-4 pt-2">
                {sectionFields.length > 0 ? sectionFields.map(renderField) : <p className="text-sm text-zinc-500">No fields in this section</p>}
              </div>
            </details>
          );
        })}
      </div>
      </div>
    );
  }

  if (viewType === "list_detail") {
    return (
      <div>
      {PinnedCard}
      <div className="flex gap-4">
        <div className="w-48 shrink-0 rounded border border-zinc-200 bg-zinc-50 p-2">
          <div className="text-xs font-medium uppercase text-zinc-500">Nominees</div>
          <div className="mt-2 text-sm text-zinc-600">Sample nominee</div>
        </div>
        <div className="min-w-0 flex-1 space-y-2 rounded border border-zinc-200 bg-white p-4">
          {unpinned.map(renderField)}
        </div>
      </div>
      </div>
    );
  }

  // stacked (default)
  return (
    <div className="space-y-4">
      {PinnedCard}
      {tabList.map((s) => {
        const sectionFields = fieldsBySection[s.section_key] ?? [];
        return (
          <div key={s.section_key} className="rounded border border-zinc-200 p-4" style={{ backgroundColor: colors.cardBg }}>
            <div className="mb-2 text-sm font-medium" style={{ color: colors.headerText }}>{s.label}</div>
            <div className="space-y-3">
              {sectionFields.length > 0 ? sectionFields.map(renderField) : <p className="text-sm text-zinc-500">No fields in this section</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Inline color picker: native color input + hex text field + WSU palette dropdown */
function ColorSwatch({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  return (
    <div className="flex items-center gap-2">
      <span className="w-32 shrink-0 text-xs text-zinc-600">{label}</span>
      <div className="relative flex items-center gap-1.5" ref={ref}>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 w-10 cursor-pointer rounded border border-zinc-300"
          title="Pick a color"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            if (/^#[0-9a-fA-F]{0,6}$/.test(v)) onChange(v);
          }}
          className="w-20 rounded border border-zinc-300 px-1.5 py-1 text-xs font-mono"
          placeholder="#000000"
        />
        <button
          type="button"
          onClick={() => setOpen((p) => !p)}
          className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
          title="WSU color palette"
        >
          WSU ▾
        </button>
        {open && (
          <div className="absolute left-0 top-full z-20 mt-1 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
              WSU Palette
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {WSU_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  title={`${c.name} (${c.value})`}
                  onClick={() => { onChange(c.value); setOpen(false); }}
                  className="flex flex-col items-center gap-0.5 rounded p-1 hover:bg-zinc-50"
                >
                  <span
                    className="block h-6 w-6 rounded border border-zinc-200 shadow-sm"
                    style={{ backgroundColor: c.value }}
                  />
                  <span className="text-[9px] leading-tight text-zinc-500 text-center">{c.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
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
    viewConfigs: { view_type: string; settings_json?: { colors?: LayoutColors; pinnedFieldKeys?: string[] } | null }[];
    viewSections?: ViewSection[];
    sectionFields?: Array<{ view_section_id: string; field_config_id: string; sort_order: number }>;
  } | null>(null);
  const [mapped, setMapped] = useState<MappedField[]>([]);
  const [sections, setSections] = useState<ViewSection[]>([]);
  const [viewType, setViewType] = useState("tabbed");
  const [colors, setColors] = useState<LayoutColors>(DEFAULT_COLORS);
  const [purposeOverrides, setPurposeOverrides] = useState<Record<string, PurposeOverride>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [error, setError] = useState("");
  const historyRef = useRef<MappedField[][]>([]);
  const [canUndo, setCanUndo] = useState(false);

  function pushHistory(current: MappedField[]) {
    historyRef.current = [...historyRef.current.slice(-19), [...current]];
    setCanUndo(true);
  }

  function undo() {
    const prev = historyRef.current.pop();
    if (prev) {
      setMapped(prev);
      setCanUndo(historyRef.current.length > 0);
    }
  }

  useEffect(() => {
    fetch(`/api/admin/cycles/${cycleId}/builder`)
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        let pinnedFieldKeys: string[] = [];
        if (d.viewConfigs?.[0]) {
          setViewType(d.viewConfigs[0].view_type);
          const settings = d.viewConfigs[0].settings_json;
          if (settings?.colors) setColors({ ...DEFAULT_COLORS, ...settings.colors });
          pinnedFieldKeys = settings?.pinnedFieldKeys ?? [];
          if (settings?.purposeOverrides) setPurposeOverrides(settings.purposeOverrides);
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
            { section_key: "main", label: "Review", sort_order: 0 },
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
              pinned: pinnedFieldKeys.includes(fc.field_key),
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
    pushHistory(mapped);
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
      { section_key, label: `Section ${n + 1}`, sort_order: n },
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
    pushHistory(mapped);
    setMapped((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateMapping(idx: number, updates: Partial<MappedField>) {
    pushHistory(mapped);
    setMapped((prev) =>
      prev.map((m, i) => (i === idx ? { ...m, ...updates } : m))
    );
  }

  function isPurposeEditable(purpose: string): boolean {
    const override = purposeOverrides[purpose];
    if (override?.editable !== undefined) return override.editable;
    return purpose === "score" || purpose === "comments";
  }

  function getPurposeLabel(purpose: string): string {
    return purposeOverrides[purpose]?.label ?? PURPOSES.find((p) => p.value === purpose)?.label ?? purpose;
  }

  function ensurePermissions(m: MappedField): MappedField {
    const roles = data?.roles ?? [];
    const canEdit = isPurposeEditable(m.purpose);
    return {
      ...m,
      permissions: roles.map((r) => {
        const existing = m.permissions?.find((p) => p.roleId === r.id);
        return {
          roleId: r.id,
          canView: existing?.canView ?? true,
          canEdit,
        };
      }),
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
          colors,
          pinnedFieldKeys: mapped.filter((m) => m.pinned).map((m) => m.fieldKey),
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
          purposeOverrides,
          sections: ["tabbed", "stacked", "accordion"].includes(viewType) && sections.length > 0
            ? sections.map((s, i) => ({ section_key: s.section_key, label: s.label, sort_order: s.sort_order ?? i }))
            : undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? "Failed to save");
        return;
      }
      setLastSavedAt(new Date().toLocaleTimeString());
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

  const usesSections = ["tabbed", "stacked", "accordion"].includes(viewType);
  const gridColsBase = "20px minmax(120px,1fr) minmax(70px,1fr) 50px minmax(100px,1fr) minmax(120px,1.5fr)";
  const gridColsFull = usesSections
    ? `${gridColsBase} minmax(100px,1fr) 60px auto`
    : `${gridColsBase} 60px auto`;

  return (
    <div className="mt-6 space-y-4">
      <AccordionCard title="Map columns" defaultOpen>
        <p className="mb-3 text-sm text-zinc-600">
          Click a column to add it to the field mapping. Unmapped columns are shown below.
        </p>
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
      </AccordionCard>

      <AccordionCard title="Purpose & role visibility">
        <p className="mb-3 text-sm text-zinc-600">
          Customize purpose labels and descriptions. Mark purposes as <strong>editable</strong> to allow reviewers to change values (writes to Smartsheet). If a purpose is editable, all roles can edit fields with that purpose.
        </p>
        <div className="mb-4 grid gap-3 rounded-lg border border-zinc-100 bg-zinc-50 p-3 sm:grid-cols-2">
          {PURPOSES.map((p) => (
            <div key={p.value} className="flex flex-col gap-1.5 rounded border border-zinc-200 bg-white p-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={purposeOverrides[p.value]?.label ?? p.label}
                  onChange={(e) =>
                    setPurposeOverrides((prev) => ({
                      ...prev,
                      [p.value]: { ...prev[p.value], label: e.target.value || undefined },
                    }))
                  }
                  placeholder={p.label}
                  className="flex-1 rounded border border-zinc-300 px-2 py-1 text-sm font-medium"
                />
                <label className="flex shrink-0 items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={purposeOverrides[p.value]?.editable ?? (p.value === "score" || p.value === "comments")}
                    onChange={(e) =>
                      setPurposeOverrides((prev) => ({
                        ...prev,
                        [p.value]: { ...prev[p.value], editable: e.target.checked },
                      }))
                    }
                  />
                  editable
                </label>
              </div>
              <input
                type="text"
                value={purposeOverrides[p.value]?.desc ?? p.desc}
                onChange={(e) =>
                  setPurposeOverrides((prev) => ({
                    ...prev,
                    [p.value]: { ...prev[p.value], desc: e.target.value || undefined },
                  }))
                }
                placeholder={p.desc}
                className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-600"
              />
            </div>
          ))}
        </div>
      </AccordionCard>

      <AccordionCard title="Columns" defaultOpen>
        <p className="mb-2 text-xs text-zinc-500">
          Drag to reorder. Order determines display in reviewer layout.
        </p>
        <div className="space-y-2">
          <div
            className="grid gap-3 rounded border-b border-zinc-200 pb-2 text-xs font-medium uppercase tracking-wide text-zinc-500"
            style={{ gridTemplateColumns: gridColsFull }}
          >
            <span className="w-5" aria-hidden />
            <span>Column</span>
            <span>Type</span>
            <span>Locked</span>
            <span>Purpose</span>
            <span>Display label</span>
            {usesSections && <span>Section</span>}
            <span>Header</span>
            <span />
          </div>
          {mapped.map((m, idx) => {
            const col = columns.find((c) => c.id === m.sourceColumnId);
            const colType = col?.type ?? "—";
            const colLocked = col?.locked ?? false;
            const isEditablePurpose = isPurposeEditable(m.purpose);
            const lockedConflict = colLocked && isEditablePurpose;
            const gridCols = gridColsFull;
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
                </div>
                <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-mono text-zinc-600" title="Smartsheet column type">
                  {colType}
                </span>
                <div className="flex items-center" title="Column is locked in Smartsheet">
                  {colLocked ? (
                    <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] text-amber-800">🔒</span>
                  ) : (
                    <span className="text-zinc-300">—</span>
                  )}
                </div>
                <div className="flex flex-col gap-1">
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
                        <option key={p.value} value={p.value} title={purposeOverrides[p.value]?.desc ?? p.desc}>
                          {getPurposeLabel(p.value)}
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
                {usesSections && (
                  m.pinned ? (
                    <span className="text-xs text-zinc-400 italic">—</span>
                  ) : (
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
                  )
                )}
                <label className="flex cursor-pointer items-center gap-1" title="Pin to header card — always visible above tabs">
                  <input
                    type="checkbox"
                    checked={m.pinned ?? false}
                    onChange={(e) => updateMapping(idx, { pinned: e.target.checked })}
                    className="rounded border-zinc-300"
                  />
                  <span className="text-xs text-zinc-500">Pin</span>
                </label>
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
      </AccordionCard>

      <AccordionCard title="Layout">
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

        <div className="mt-5 border-t border-zinc-100 pt-4">
          <h3 className="mb-1 text-sm font-medium text-zinc-700">Colors</h3>
          <p className="mb-3 text-xs text-zinc-500">
            Customize reviewer UI colors. Defaults are WSU brand colors.
          </p>
          <div className="space-y-2.5">
            <ColorSwatch
              label="Accent"
              value={colors.accent}
              onChange={(v) => setColors((c) => ({ ...c, accent: v }))}
            />
            <ColorSwatch
              label="Header background"
              value={colors.headerBg}
              onChange={(v) => setColors((c) => ({ ...c, headerBg: v }))}
            />
            <ColorSwatch
              label="Header text"
              value={colors.headerText}
              onChange={(v) => setColors((c) => ({ ...c, headerText: v }))}
            />
            <ColorSwatch
              label="Card background"
              value={colors.cardBg}
              onChange={(v) => setColors((c) => ({ ...c, cardBg: v }))}
            />
          </div>
          <button
            type="button"
            onClick={() => setColors(DEFAULT_COLORS)}
            className="mt-2 text-xs text-zinc-400 hover:text-zinc-600 hover:underline"
          >
            Reset to WSU defaults
          </button>
        </div>
      </AccordionCard>

      {usesSections && (
        <AccordionCard title="Tabs">
          <p className="mb-3 text-sm text-zinc-600">
            Define sections used for tabbed, stacked, and accordion layouts. Assign fields to sections using the Section column in the Columns table above.
          </p>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium text-zinc-700">Sections</span>
            <button
              type="button"
              onClick={addSection}
              className="rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
            >
              + Add section
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
                  placeholder="Section label"
                />
                {sections.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeSection(i)}
                    className="text-xs text-red-600 hover:text-red-700"
                    title="Remove section"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
        </AccordionCard>
      )}

      <AccordionCard title="Preview">
        <p className="mb-3 text-sm text-zinc-600">
          Preview updates when you change the layout template. Score dropdowns show options from the Smartsheet column.
        </p>
        <LayoutPreview mapped={mapped} viewType={viewType} columns={columns} sections={sections} colors={colors} />
      </AccordionCard>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}
      {lastSavedAt && (
        <p className="text-sm text-green-600">Saved at {lastSavedAt}</p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded bg-[var(--wsu-crimson)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--wsu-crimson-hover)] disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save configuration"}
        </button>
        <button
          type="button"
          onClick={undo}
          disabled={!canUndo}
          className="rounded border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
        >
          Undo
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
