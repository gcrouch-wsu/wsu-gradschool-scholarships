"use client";

import React, { useEffect, useRef, useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { RowLayoutEditor } from "@/components/layout/RowLayoutEditor";
import type { SavedLayoutJson } from "@/lib/layout";
import type { DraftLayoutJson } from "@/lib/layout-editor";
import {
  appendFieldAsFullRow,
  createDraftLayout,
  getFieldSectionKey,
  normalizeDraftLayout,
  removeFieldFromDraftLayout,
  syncDraftLayoutSections,
} from "@/lib/layout-editor";
import { bindFieldsToLayout, getBoundRowDesktopColumnCount } from "@/lib/layout-runtime";

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
  help_text: string | null;
  display_type: string;
  sort_order: number;
}

interface Role {
  id: string;
  key: string;
  label: string;
  sort_order?: number;
}

function RoleRow({
  role,
  canDelete,
  operatingOn,
  onRename,
  onDelete,
}: {
  role: Role;
  canDelete: boolean;
  operatingOn: boolean;
  onRename: (label: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(role.label);

  function commit() {
    if (label.trim() && label.trim() !== role.label) onRename(label.trim());
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="grid gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-3 md:grid-cols-[minmax(140px,180px)_minmax(0,1fr)_auto] md:items-center">
        <div className="rounded-full bg-zinc-100 px-3 py-1 text-[11px] font-mono font-medium uppercase tracking-wide text-zinc-500">
          {role.key}
        </div>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setLabel(role.label); setEditing(false); } }}
          autoFocus
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
        />
        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          <button
            type="button"
            onClick={commit}
            className="inline-flex items-center rounded-md bg-[var(--wsu-crimson)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--wsu-crimson-hover)]"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => { setLabel(role.label); setEditing(false); }}
            className="inline-flex items-center rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-3 rounded-xl border border-zinc-200 bg-zinc-50/70 px-3 py-3 md:grid-cols-[minmax(140px,180px)_minmax(0,1fr)_auto] md:items-center">
      <span
        className="inline-flex w-fit items-center rounded-full bg-white px-3 py-1 text-[11px] font-mono font-medium uppercase tracking-wide text-zinc-500 ring-1 ring-inset ring-zinc-200"
        title={role.key}
      >
        {role.key}
      </span>
      <span className="text-sm font-medium text-zinc-800">{role.label}</span>
      <div className="flex flex-wrap items-center gap-2 md:justify-end">
        <button
          type="button"
          onClick={() => setEditing(true)}
          disabled={operatingOn}
          className="inline-flex items-center rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
        >
          Rename
        </button>
        {canDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={operatingOn}
            className="inline-flex items-center rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-40"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function AddRoleForm({ loading, onCreate }: { loading: boolean; onCreate: (label: string) => void }) {
  const [label, setLabel] = useState("");
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (label.trim()) { onCreate(label.trim()); setLabel(""); }
  }
  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 grid gap-3 rounded-xl border border-dashed border-zinc-300 bg-zinc-50/70 px-3 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
    >
      <input
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="New role label…"
        className="rounded-md border border-zinc-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
      />
      <button
        type="submit"
        disabled={loading || !label.trim()}
        className="inline-flex h-10 items-center justify-center rounded-md border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
      >
        {loading ? "Adding…" : "+ Add role"}
      </button>
    </form>
  );
}

interface MappedField {
  sourceColumnId: number;
  sourceColumnTitle: string;
  purpose: string;
  displayLabel: string;
  helperText: string;
  displayType: string;
  sortOrder: number;
  fieldKey: string;
  sectionKey?: string;
  pinned?: boolean;
  hiddenInBlindReview?: boolean;
  isNew?: boolean;
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
  layoutJson,
  blindReviewEnabled,
}: {
  mapped: MappedField[];
  viewType: string;
  columns: Column[];
  sections: ViewSection[];
  colors: LayoutColors;
  layoutJson: SavedLayoutJson;
  blindReviewEnabled?: boolean;
}) {
  const [previewValues, setPreviewValues] = useState<Record<string, string>>({});
  const previewMapped = blindReviewEnabled
    ? mapped.filter((m) => !m.hiddenInBlindReview)
    : mapped;
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

  if (previewMapped.length === 0) {
    return <p className="text-sm text-zinc-500">No fields mapped yet.</p>;
  }

  const boundLayout = bindFieldsToLayout({
    layoutJson,
    fields: previewMapped,
    getFieldKey: (field) => field.fieldKey,
    sections: tabList,
    pinnedFieldKeys: layoutJson.pinned_field_keys ?? [],
  });
  const pinnedFields = boundLayout.pinnedFields;
  const sectionsWithRows = boundLayout.sections;

  const PinnedCard = pinnedFields.length > 0 ? (
    <div
      className="mb-3 rounded-lg border border-zinc-200 px-4 py-3"
      style={{ backgroundColor: colors.headerBg }}
    >
      <div className="flex flex-wrap gap-x-8 gap-y-1.5">
        {pinnedFields.map((m) => (
          <div key={m.fieldKey}>
            <span className="block text-[10px] uppercase tracking-wide text-zinc-400">{m.displayLabel}</span>
            {m.helperText && (
              <span className="mt-1 block max-w-48 text-[11px] leading-4 text-zinc-500">
                {m.helperText}
              </span>
            )}
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
        {m.helperText && (
          <p className="mt-1 text-xs leading-5 text-zinc-500">{m.helperText}</p>
        )}
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
              className="mt-1 rounded-md border border-zinc-300 px-2 py-1 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
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

  function renderRow(row: { row_key: string; items: Array<{ field: MappedField; width: "full" | "half" | "third" }> }) {
    const desktopColumns = getBoundRowDesktopColumnCount(row);
    if (desktopColumns === 2) {
      return (
        <div key={row.row_key} className="grid gap-3 md:grid-cols-2">
          {row.items.map(({ field }) => renderField(field))}
        </div>
      );
    }
    if (desktopColumns === 3) {
      return (
        <div key={row.row_key} className="grid gap-3 md:grid-cols-3">
          {row.items.map(({ field }) => renderField(field))}
        </div>
      );
    }
    return (
      <div key={row.row_key} className="space-y-3">
        {row.items.map(({ field }) => renderField(field))}
      </div>
    );
  }

  if (viewType === "tabbed") {
    const activeSection = sectionsWithRows.find((section) => section.section_key === activeTab);
    const activeRows = activeSection?.rows ?? [];
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
          {activeRows.length > 0 ? (
            <div className="space-y-3">{activeRows.map(renderRow)}</div>
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
        {sectionsWithRows.map((s) => {
          const sectionRows = s.rows ?? [];
          return (
            <details key={s.section_key} className="rounded border border-zinc-200 bg-white">
              <summary className="cursor-pointer px-4 py-2 font-medium text-zinc-900">
                {s.label}
              </summary>
              <div className="space-y-2 border-t border-zinc-200 px-4 pb-4 pt-2">
                {sectionRows.length > 0 ? sectionRows.map(renderRow) : <p className="text-sm text-zinc-500">No fields in this section</p>}
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
          {sectionsWithRows.flatMap((section) => section.rows).map(renderRow)}
        </div>
      </div>
      </div>
    );
  }

  // stacked (default)
  return (
    <div className="space-y-4">
      {PinnedCard}
      {sectionsWithRows.map((s) => {
        const sectionRows = s.rows ?? [];
        return (
          <div key={s.section_key} className="rounded border border-zinc-200 p-4" style={{ backgroundColor: colors.cardBg }}>
            <div className="mb-2 text-sm font-medium" style={{ color: colors.headerText }}>{s.label}</div>
            <div className="space-y-3">
              {sectionRows.length > 0 ? sectionRows.map(renderRow) : <p className="text-sm text-zinc-500">No fields in this section</p>}
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
          className="w-20 rounded-md border border-zinc-300 px-1.5 py-1 text-xs font-mono focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
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
    viewConfigs: {
      view_type: string;
      layout_json?: SavedLayoutJson | null;
      settings_json?: {
        colors?: LayoutColors;
        pinnedFieldKeys?: string[];
        hiddenFieldKeys?: string[];
        blindReview?: boolean;
      } | null;
    }[];
    viewSections?: ViewSection[];
    sectionFields?: Array<{ view_section_id: string; field_config_id: string; sort_order: number }>;
  } | null>(null);
  const [mapped, setMapped] = useState<MappedField[]>([]);
  const [sections, setSections] = useState<ViewSection[]>([]);
  const [viewType, setViewType] = useState("tabbed");
  const [colors, setColors] = useState<LayoutColors>(DEFAULT_COLORS);
  const [purposeOverrides, setPurposeOverrides] = useState<Record<string, PurposeOverride>>({});
  const [blindReviewEnabled, setBlindReviewEnabled] = useState(false);
  const [layoutDraft, setLayoutDraft] = useState<DraftLayoutJson>(() =>
    createDraftLayout(null, [{ section_key: "main", label: "Review", sort_order: 0 }])
  );
  const [roles, setRoles] = useState<Role[]>([]);
  const [roleOperating, setRoleOperating] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
        setRoles(d.roles ?? []);
        let pinnedFieldKeys: string[] = [];
        let hiddenFieldKeys: string[] = [];
        if (d.viewConfigs?.[0]) {
          setViewType(d.viewConfigs[0].view_type);
          const settings = d.viewConfigs[0].settings_json;
          if (settings?.colors) setColors({ ...DEFAULT_COLORS, ...settings.colors });
          pinnedFieldKeys = settings?.pinnedFieldKeys ?? [];
          hiddenFieldKeys = settings?.hiddenFieldKeys ?? [];
          if (settings?.purposeOverrides) setPurposeOverrides(settings.purposeOverrides);
          setBlindReviewEnabled(settings?.blindReview === true);
        }
        if (d.viewSections?.length > 0) {
          const nextSections = d.viewSections
            .sort((a: ViewSection, b: ViewSection) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
            .map((vs: { id?: string; section_key: string; label: string; sort_order: number }) => ({
              id: vs.id,
              section_key: vs.section_key,
              label: vs.label,
              sort_order: vs.sort_order,
            }));
          setSections(nextSections);
          setLayoutDraft(createDraftLayout(d.viewConfigs?.[0]?.layout_json ?? null, nextSections));
        } else {
          const nextSections = [{ section_key: "main", label: "Review", sort_order: 0 }];
          setSections(nextSections);
          setLayoutDraft(createDraftLayout(d.viewConfigs?.[0]?.layout_json ?? null, nextSections));
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
              sourceColumnId: Number(fc.source_column_id),
              sourceColumnTitle: fc.source_column_title,
              purpose: fc.purpose,
              displayLabel: fc.display_label,
              helperText: fc.help_text ?? "",
              displayType: fc.display_type,
              sortOrder: fc.sort_order,
              fieldKey: fc.field_key,
              sectionKey: sectionByFieldId[fc.id],
              pinned: pinnedFieldKeys.includes(fc.field_key),
              hiddenInBlindReview: hiddenFieldKeys.includes(fc.field_key),
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
    // score/comments default to no access; all other purposes default to view-only
    const isScorePurpose = defaultPurpose === "score" || defaultPurpose === "comments";
    const defaultPerms = roles.map((r) => ({
      roleId: r.id,
      canView: !isScorePurpose,
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
        helperText: "",
        displayType: isAttachment ? "attachment_list" : DISPLAY_TYPES[defaultPurpose] ?? "short_text",
        sortOrder: prev.length,
        fieldKey: key,
        sectionKey: defaultSection,
        permissions: defaultPerms,
        isNew: true,
      },
    ]);
    setLayoutDraft((prev) => appendFieldAsFullRow(prev, key, defaultSection));
  }

  function addSection() {
    const n = sections.length;
    const section_key = `section_${n}`;
    const nextSections = [
      ...sections,
      { section_key, label: `Section ${n + 1}`, sort_order: n },
    ];
    setSections(nextSections);
    setLayoutDraft((prev) => syncDraftLayoutSections(prev, nextSections));
  }

  function updateSection(idx: number, updates: Partial<ViewSection>) {
    const nextSections = sections.map((s, i) => (i === idx ? { ...s, ...updates } : s));
    setSections(nextSections);
    setLayoutDraft((prev) => syncDraftLayoutSections(prev, nextSections));
  }

  function removeSection(idx: number) {
    const removed = sections[idx];
    if (!removed) return;
    const fallback = sections.find((_, i) => i !== idx);
    const nextSections = sections.filter((_, i) => i !== idx);
    setSections(nextSections);
    setLayoutDraft((prev) => syncDraftLayoutSections(prev, nextSections));
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
    const fieldKey = mapped[idx]?.fieldKey;
    setMapped((prev) => prev.filter((_, i) => i !== idx));
    if (fieldKey) {
      setLayoutDraft((prev) => removeFieldFromDraftLayout(prev, fieldKey));
    }
  }

  function updateMapping(idx: number, updates: Partial<MappedField>) {
    pushHistory(mapped);
    const current = mapped[idx];
    setMapped((prev) =>
      prev.map((m, i) => (i === idx ? { ...m, ...updates } : m))
    );
    if (!current) return;
    if (updates.pinned === true && !current.pinned) {
      setLayoutDraft((prev) => removeFieldFromDraftLayout(prev, current.fieldKey));
      return;
    }
    if (updates.pinned === false && current.pinned) {
      setLayoutDraft((prev) =>
        appendFieldAsFullRow(prev, current.fieldKey, sections[0]?.section_key)
      );
    }
  }

  function isPurposeEditable(purpose: string): boolean {
    const override = purposeOverrides[purpose];
    if (override?.editable !== undefined) return override.editable;
    return purpose === "score" || purpose === "comments" || purpose === "attachment";
  }

  function getPurposeLabel(purpose: string): string {
    return purposeOverrides[purpose]?.label ?? PURPOSES.find((p) => p.value === purpose)?.label ?? purpose;
  }

  function ensurePermissions(m: MappedField): MappedField {
    const defaultCanEdit = isPurposeEditable(m.purpose);
    return {
      ...m,
      permissions: roles.map((r) => {
        const existing = m.permissions?.find((p) => p.roleId === r.id);
        // Preserve per-role permissions exactly as set in the matrix.
        // Only fall back to purpose-derived defaults for roles that have no row yet.
        if (existing) return existing;
        return { roleId: r.id, canView: true, canEdit: defaultCanEdit };
      }),
    };
  }

  function updatePermission(fieldIdx: number, roleId: string, key: "canView" | "canEdit", value: boolean) {
    setMapped((prev) =>
      prev.map((m, i) => {
        if (i !== fieldIdx) return m;
        const base = m.permissions?.length
          ? m.permissions
          : roles.map((r) => ({ roleId: r.id, canView: true, canEdit: isPurposeEditable(m.purpose) }));
        const newPerms = base.map((p) => {
          if (p.roleId !== roleId) return p;
          if (key === "canEdit" && value) return { ...p, canEdit: true, canView: true };
          if (key === "canView" && !value) return { ...p, canView: false, canEdit: false };
          return { ...p, [key]: value };
        });
        return { ...m, permissions: newPerms };
      })
    );
  }

  async function handleCreateRole(label: string) {
    setRoleOperating("creating");
    setError("");
    try {
      const res = await fetch(`/api/admin/cycles/${cycleId}/roles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      if (!res.ok) { const d = await res.json(); setError(d.error ?? "Failed to create role"); return; }
      const newRole: Role = await res.json();
      setRoles((prev) => [...prev, newRole]);
      // Add default permissions for the new role to all existing mapped fields: view=false, edit=false.
      // Admin must explicitly grant access after creating a role.
      setMapped((prev) =>
        prev.map((m) => ({
          ...m,
          permissions: [
            ...(m.permissions ?? roles.map((r) => ({ roleId: r.id, canView: true, canEdit: isPurposeEditable(m.purpose) }))),
            { roleId: newRole.id, canView: false, canEdit: false },
          ],
        }))
      );
    } finally {
      setRoleOperating(null);
    }
  }

  async function handleRenameRole(roleId: string, label: string) {
    setRoleOperating(roleId);
    setError("");
    try {
      const res = await fetch(`/api/admin/cycles/${cycleId}/roles/${roleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label }),
      });
      if (!res.ok) { const d = await res.json(); setError(d.error ?? "Failed to rename role"); return; }
      const updated: Role = await res.json();
      setRoles((prev) => prev.map((r) => (r.id === roleId ? { ...r, label: updated.label } : r)));
    } finally {
      setRoleOperating(null);
    }
  }

  async function handleDeleteRole(roleId: string) {
    if (!confirm("Delete this role? This cannot be undone.")) return;
    setRoleOperating(roleId);
    setError("");
    try {
      const res = await fetch(`/api/admin/cycles/${cycleId}/roles/${roleId}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json(); setError(d.error ?? "Failed to delete role"); return; }
      setRoles((prev) => prev.filter((r) => r.id !== roleId));
      setMapped((prev) =>
        prev.map((m) => ({ ...m, permissions: m.permissions?.filter((p) => p.roleId !== roleId) }))
      );
    } finally {
      setRoleOperating(null);
    }
  }

  async function handleSave() {
    setError("");
    setSaving(true);
    try {
      const normalizedLayout = normalizeDraftLayout(layoutDraft, sections);
      const res = await fetch(`/api/admin/cycles/${cycleId}/builder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          colors,
          pinnedFieldKeys: mapped.filter((m) => m.pinned).map((m) => m.fieldKey),
          hiddenFieldKeys: mapped.filter((m) => m.hiddenInBlindReview).map((m) => m.fieldKey),
          fieldConfigs: mapped.map((m, i) => {
            const ensured = ensurePermissions(m);
            return {
              fieldKey: m.fieldKey,
              sourceColumnId: m.sourceColumnId,
              sourceColumnTitle: m.sourceColumnTitle,
              purpose: m.purpose,
              displayLabel: m.displayLabel,
              helperText: m.helperText,
              displayType: DISPLAY_TYPES[m.purpose] || m.displayType,
              sortOrder: i,
              sectionKey: getFieldSectionKey(layoutDraft, m.fieldKey) ?? m.sectionKey ?? sections[0]?.section_key,
              permissions: ensured.permissions,
            };
          }),
          layoutJson: normalizedLayout,
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
      setMapped((prev) => prev.map((m) => ({ ...m, isNew: false })));
      router.refresh();
    } catch {
      setError("An error occurred");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteConfig() {
    if (
      !confirm(
        "Delete this reviewer form? This removes the current reviewer mapping, layout, and saved config versions for this cycle. Smartsheet data will not be deleted."
      )
    ) {
      return;
    }

    setError("");
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/cycles/${cycleId}/builder`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Failed to delete reviewer form");
        return;
      }
      router.push(`/admin/scholarships/${programId}/cycles/${cycleId}`);
      router.refresh();
    } catch {
      setError("Failed to delete reviewer form");
    } finally {
      setDeleting(false);
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
  const gridColsBase = "24px minmax(180px,1.35fr) 136px 72px minmax(160px,0.95fr) minmax(220px,1.25fr)";
  const gridColsFull = usesSections
    ? `${gridColsBase} 116px 84px 84px 88px`
    : `${gridColsBase} 84px 84px 88px`;

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
        <div className={`mb-3 rounded-lg border px-3 py-2 text-sm ${blindReviewEnabled ? "border-amber-200 bg-amber-50 text-amber-900" : "border-zinc-200 bg-zinc-50 text-zinc-700"}`}>
          Blind review is <strong>{blindReviewEnabled ? "ON" : "OFF"}</strong>.
          {blindReviewEnabled
            ? " Only columns marked Hide will be hidden from reviewers."
            : " No columns are hidden unless you enable blind review on the cycle page."}
        </div>
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
                  className="flex-1 rounded-md border border-zinc-300 px-2 py-1 text-sm font-medium focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
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
                className="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-600 focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
              />
            </div>
          ))}
        </div>
      </AccordionCard>

      <AccordionCard title="Fields" defaultOpen>
        <p className="mb-2 text-xs text-zinc-500">
          Use one workspace for both field settings and exact row placement. Drag to reorder the field library, then place fields into rows below.
        </p>
        <RowLayoutEditor
          layout={layoutDraft}
          fields={mapped
            .filter((field) => !field.pinned)
            .map((field) => ({
              field_key: field.fieldKey,
              label: field.displayLabel || field.sourceColumnTitle,
              badge: getPurposeLabel(field.purpose),
            }))}
          sections={sections}
          onChange={setLayoutDraft}
          title="Reviewer row layout"
          description="Arrange reviewer fields into exact rows inside each section. A row can be one full-width field, two side-by-side fields, or three compact fields."
        />
        <div className="mt-5 border-t border-zinc-100 pt-5">
          <div className="overflow-x-auto">
            <div className="min-w-[1180px] space-y-2.5 pb-1">
              <div
                className="grid items-center gap-4 rounded-xl bg-zinc-50 px-2.5 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500"
                style={{ gridTemplateColumns: gridColsFull }}
              >
                <span aria-hidden />
                <span>Column</span>
                <span>Type</span>
                <span className="justify-self-center">Locked</span>
                <span>Purpose</span>
                <span>Label & help</span>
                {usesSections && <span title="Section is assigned via the layout editor above">Section</span>}
                <span title="Pin this field to the header card — always visible above tabs">Pin</span>
                <span title="Hide from reviewers when blind review is on">Blind</span>
                <span className="justify-self-end">Action</span>
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
                    className={`grid items-start gap-4 rounded-xl border px-3 py-3.5 shadow-sm ${lockedConflict ? "border-amber-300 bg-amber-50/70" : "border-zinc-200 bg-white"}`}
                    style={{ gridTemplateColumns: gridCols }}
                  >
                    {lockedConflict && (
                      <div className="col-span-full -mt-1 mb-1 flex items-center gap-2 rounded-lg bg-amber-100 px-2.5 py-2 text-xs text-amber-800">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-amber-200 font-semibold text-amber-900">
                          !
                        </span>
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
                      className="flex w-6 shrink-0 cursor-grab items-center justify-center self-stretch text-zinc-300 hover:text-zinc-500 active:cursor-grabbing"
                      title="Drag to reorder"
                      aria-hidden
                    >
                      ⠿
                    </div>
                    <div className="min-w-0 self-center">
                      <span className="block text-sm font-medium leading-6 text-zinc-800">{m.sourceColumnTitle}</span>
                    </div>
                    <span className="inline-flex w-fit self-center rounded-full bg-zinc-100 px-2.5 py-1 text-[10px] font-mono font-medium uppercase tracking-wide text-zinc-600" title="Smartsheet column type">
                      {colType}
                    </span>
                    <div className="flex items-center justify-center self-center" title="Column is locked in Smartsheet">
                      {colLocked ? (
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-800">
                          Locked
                        </span>
                      ) : (
                        <span className="text-zinc-300">—</span>
                      )}
                    </div>
                    <div className="self-center">
                      <select
                        value={m.purpose}
                        onChange={(e) =>
                          updateMapping(idx, {
                            purpose: e.target.value,
                            displayType: DISPLAY_TYPES[e.target.value] || m.displayType,
                          })
                        }
                        className="rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
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
                    <div className="grid gap-2 self-center">
                      <input
                        type="text"
                        value={m.displayLabel}
                        onChange={(e) => updateMapping(idx, { displayLabel: e.target.value })}
                        placeholder="Display label"
                        className="rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
                      />
                      <textarea
                        value={m.helperText}
                        onChange={(e) => updateMapping(idx, { helperText: e.target.value })}
                        placeholder="Helper text or instructions (optional)"
                        rows={2}
                        className="rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
                      />
                    </div>
                    {usesSections && (
                      m.pinned ? (
                        <span
                          className="inline-flex min-h-10 items-center justify-center rounded-md border border-dashed border-zinc-200 bg-zinc-50 px-3 text-xs font-medium uppercase tracking-wide text-zinc-400"
                          title="Pinned fields are not in a section"
                        >
                          Pinned
                        </span>
                      ) : (
                        <span className="inline-flex min-h-10 items-center rounded-md bg-zinc-100 px-3 text-sm font-medium text-zinc-700" title="Assign sections via the layout editor above">
                          {sections.find(
                            (section) =>
                              section.section_key ===
                              (getFieldSectionKey(layoutDraft, m.fieldKey) ??
                                m.sectionKey ??
                                sections[0]?.section_key)
                          )?.label ?? "Review"}
                        </span>
                      )
                    )}
                    <label
                      className="flex min-h-10 cursor-pointer items-center justify-center gap-2 self-center rounded-md border border-zinc-200 bg-zinc-50 px-2.5"
                      title="Pin to header card — always visible above tabs"
                    >
                      <input
                        type="checkbox"
                        checked={m.pinned ?? false}
                        onChange={(e) => updateMapping(idx, { pinned: e.target.checked })}
                        className="rounded border-zinc-300"
                      />
                      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Pin</span>
                    </label>
                    <label
                      className="flex min-h-10 cursor-pointer items-center justify-center gap-2 self-center rounded-md border border-zinc-200 bg-zinc-50 px-2.5"
                      title="Hide this field from reviewers when blind review is enabled"
                    >
                      <input
                        type="checkbox"
                        checked={m.hiddenInBlindReview ?? false}
                        onChange={(e) => updateMapping(idx, { hiddenInBlindReview: e.target.checked })}
                        className="rounded border-zinc-300"
                      />
                      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Blind</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => removeMapping(idx)}
                      className="inline-flex min-h-10 items-center justify-center self-center justify-self-end rounded-md border border-red-200 px-3 text-sm font-medium text-red-700 hover:bg-red-50"
                    >
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </AccordionCard>

      <AccordionCard title="Roles & Permissions" defaultOpen={roles.length > 1}>
        <p className="mb-3 text-sm text-zinc-600">
          Define reviewer roles for this cycle, then set per-role field access in the matrix below.{" "}
          <strong>View</strong> lets the reviewer see the field. <strong>Edit</strong> allows writing
          to Smartsheet (enabling Edit automatically enables View).
        </p>

        <div className="mb-4">
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">Roles</div>
          <div className="space-y-1.5">
            {roles.map((role) => (
              <RoleRow
                key={role.id}
                role={role}
                canDelete={roles.length > 1}
                operatingOn={roleOperating === role.id}
                onRename={(label) => handleRenameRole(role.id, label)}
                onDelete={() => handleDeleteRole(role.id)}
              />
            ))}
          </div>
          {roles.length < 10 ? (
            <AddRoleForm loading={roleOperating === "creating"} onCreate={handleCreateRole} />
          ) : (
            <p className="mt-2 text-xs text-amber-600">Maximum of 10 roles reached.</p>
          )}
        </div>

        {mapped.length > 0 && roles.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
            <div className="border-b border-zinc-200 px-4 py-3 text-xs font-medium uppercase tracking-wide text-zinc-500">
              Permissions matrix
            </div>
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-zinc-50">
                  <th className="w-48 px-4 pb-2 pt-4 text-left text-xs font-medium uppercase tracking-wide text-zinc-500">Field</th>
                  {roles.map((role) => (
                    <th key={role.id} className="px-3 pb-1 pt-4 text-center text-xs font-medium text-zinc-700" colSpan={2}>
                      {role.label}
                    </th>
                  ))}
                </tr>
                <tr className="border-b border-zinc-200 bg-zinc-50">
                  <th />
                  {roles.map((role) => (
                    <React.Fragment key={role.id}>
                      <th className="px-2 pb-3 text-center text-[10px] font-medium uppercase tracking-wide text-zinc-400">View</th>
                      <th className="px-2 pb-3 text-center text-[10px] font-medium uppercase tracking-wide text-zinc-400">Edit</th>
                    </React.Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mapped.map((m, fieldIdx) => {
                  const fieldPerms = m.permissions?.length
                    ? m.permissions
                    : roles.map((r) => ({ roleId: r.id, canView: true, canEdit: isPurposeEditable(m.purpose) }));
                  const isUnsaved = m.isNew === true;
                  return (
                    <tr key={m.fieldKey} className={`border-t border-zinc-100 ${isUnsaved ? "bg-amber-50/70" : ""}`}>
                      <td className="px-4 py-3 text-xs text-zinc-700">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium text-zinc-800">{m.displayLabel || m.sourceColumnTitle}</span>
                          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                            {m.purpose}
                          </span>
                          {isUnsaved && (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-800">
                              New
                            </span>
                          )}
                        </div>
                      </td>
                      {roles.map((role) => {
                        const perm = fieldPerms.find((p) => p.roleId === role.id) ?? { roleId: role.id, canView: false, canEdit: false };
                        return (
                          <React.Fragment key={role.id}>
                            <td className="px-2 py-3 text-center">
                              <input
                                type="checkbox"
                                checked={perm.canView}
                                onChange={(e) => updatePermission(fieldIdx, role.id, "canView", e.target.checked)}
                                className="h-4 w-4 rounded border-zinc-300"
                                title={`${role.label}: view ${m.displayLabel}`}
                              />
                            </td>
                            <td className="px-2 py-3 text-center">
                              <input
                                type="checkbox"
                                checked={perm.canEdit}
                                onChange={(e) => updatePermission(fieldIdx, role.id, "canEdit", e.target.checked)}
                                className="h-4 w-4 rounded border-zinc-300"
                                title={`${role.label}: edit ${m.displayLabel}`}
                              />
                            </td>
                          </React.Fragment>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-zinc-400">Map columns first to configure permissions.</p>
        )}
      </AccordionCard>

      <AccordionCard title="Layout">
        <p className="mb-3 text-sm text-zinc-600">
          How the reviewer form is organized for live reviewers.
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
            Define sections used for tabbed, stacked, and accordion layouts. Row placement inside each section is controlled in the Row layout panel above.
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
                  className="w-32 rounded border-0 bg-transparent px-1 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
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

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}
      {lastSavedAt && (
        <p className="text-sm text-green-600">Saved at {lastSavedAt}</p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || deleting}
          className="rounded bg-[var(--wsu-crimson)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--wsu-crimson-hover)] disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save configuration"}
        </button>
        <button
          type="button"
          onClick={undo}
          disabled={!canUndo || deleting}
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
        <button
          type="button"
          onClick={handleDeleteConfig}
          disabled={deleting || saving}
          className="rounded border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
        >
          {deleting ? "Deleting..." : "Delete reviewer form"}
        </button>
      </div>
    </div>
  );
}
