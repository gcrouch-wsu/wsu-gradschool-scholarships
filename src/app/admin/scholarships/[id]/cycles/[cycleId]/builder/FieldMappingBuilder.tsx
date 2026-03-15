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

/** Map Smartsheet column type → purposes that make sense for that type. Uses actual API types; no arbitrary types. */
const SMARTSHEET_TYPE_TO_PURPOSES: Record<string, string[]> = {
  TEXT_NUMBER: ["identity", "subtitle", "narrative", "score", "comments", "metadata"],
  PICKLIST: ["identity", "subtitle", "score", "metadata"],
  MULTI_PICKLIST: ["score", "metadata"],
  CHECKBOX: ["score", "metadata"],
  CONTACT_LIST: ["identity", "subtitle", "metadata"],
  MULTI_CONTACT_LIST: ["metadata"],
  DATE: ["identity", "subtitle", "metadata"],
  DATETIME: ["metadata"],
  ABSTRACT_DATETIME: ["metadata"],
  DURATION: ["metadata"],
  PREDECESSOR: ["metadata"],
  attachment_list: ["attachment"],
};

function getPurposesForColumnType(colType: string): Array<(typeof PURPOSES)[number]> {
  const allowed = SMARTSHEET_TYPE_TO_PURPOSES[colType];
  if (!allowed?.length) return [...PURPOSES];
  return PURPOSES.filter((p) => allowed.includes(p.value));
}

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
  permissions?: Array<{ roleId: string; canView: boolean; canEdit: boolean }>;
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
  } | null>(null);
  const [mapped, setMapped] = useState<MappedField[]>([]);
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
          setMapped(
            d.fieldConfigs.map((fc: FieldConfig) => ({
              sourceColumnId: fc.source_column_id,
              sourceColumnTitle: fc.source_column_title,
              purpose: fc.purpose,
              displayLabel: fc.display_label,
              displayType: fc.display_type,
              sortOrder: fc.sort_order,
              fieldKey: fc.field_key,
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
        permissions: defaultPerms,
      },
    ]);
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
              permissions: ensured.permissions,
            };
          }),
          viewType,
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

        <div className="mb-4 flex flex-wrap gap-2">
          {unmappedColumns.map((col) => (
            <button
              key={col.id}
              type="button"
              onClick={() => addColumn(col)}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
            >
              + {col.title}
            </button>
          ))}
          {unmappedColumns.length === 0 && columns.length > 0 && (
            <span className="text-sm text-zinc-500">All columns mapped</span>
          )}
        </div>

        <details className="mb-3 text-xs text-zinc-500">
          <summary className="cursor-pointer hover:text-zinc-700">Purpose definitions (mapped from Smartsheet column type)</summary>
          <ul className="mt-2 space-y-1 pl-4">
            {PURPOSES.map((p) => (
              <li key={p.value}><strong>{p.label}</strong>: {p.desc}</li>
            ))}
          </ul>
          <p className="mt-2 pl-4 italic">Purpose options are filtered by the column&apos;s Smartsheet type (TEXT_NUMBER, PICKLIST, etc.).</p>
        </details>
        <p className="mb-2 text-xs text-zinc-500">
          Drag to reorder. Order determines display in reviewer layout.
        </p>
        <div className="space-y-2">
          <div className="grid grid-cols-[minmax(140px,1fr)_minmax(120px,1fr)_minmax(140px,1.5fr)_auto] gap-3 rounded border-b border-zinc-200 pb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
            <span>Column</span>
            <span>Purpose</span>
            <span>Display label</span>
            <span />
          </div>
          {mapped.map((m, idx) => {
            const col = columns.find((c) => c.id === m.sourceColumnId);
            const colType = col?.type ?? "—";
            const colLocked = col?.locked ?? false;
            const isEditablePurpose = m.purpose === "score" || m.purpose === "comments";
            const lockedConflict = colLocked && isEditablePurpose;
            return (
              <div
                key={m.fieldKey}
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
                className={`grid grid-cols-[minmax(140px,1fr)_minmax(120px,1fr)_minmax(140px,1.5fr)_auto] gap-3 items-center rounded border p-3 active:cursor-grabbing cursor-grab ${lockedConflict ? "border-amber-300 bg-amber-50/50" : "border-zinc-200 bg-zinc-50"}`}
              >
                <div className="min-w-0">
                  <span className="font-medium text-zinc-700">{m.sourceColumnTitle}</span>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-mono text-zinc-600" title="Smartsheet column type">
                      {colType}
                    </span>
                    {colLocked && (
                      <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] text-amber-800" title="Column is locked in Smartsheet — reviewers cannot write to it">
                        Locked
                      </span>
                    )}
                  </div>
                </div>
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
                <input
                  type="text"
                  value={m.displayLabel}
                  onChange={(e) => updateMapping(idx, { displayLabel: e.target.value })}
                  placeholder="Display label"
                  className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
                />
                <button
                  type="button"
                  onClick={() => removeMapping(idx)}
                  className="text-sm text-red-600 hover:underline justify-self-end"
                >
                  Remove
                </button>
                {lockedConflict && (
                  <div className="col-span-full text-xs text-amber-700">
                    This column is locked in Smartsheet. Making it editable here will cause write conflicts. Use a different column or unlock it in Smartsheet.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

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
        <div className="flex flex-wrap gap-2">
          {LAYOUTS.map((l) => (
            <label key={l.value} className="flex items-center gap-2">
              <input
                type="radio"
                name="layout"
                value={l.value}
                checked={viewType === l.value}
                onChange={() => setViewType(l.value)}
              />
              <span className="text-sm">{l.label}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <h2 className="mb-2 font-medium text-zinc-900">4. Preview</h2>
        <p className="mb-3 text-sm text-zinc-600">
          Simplified preview of the reviewer layout. Full runtime in Phase 4.
        </p>
        <div className="rounded border border-zinc-200 bg-white p-4">
          {mapped.length === 0 ? (
            <p className="text-sm text-zinc-500">No fields mapped yet.</p>
          ) : (
            <div className="space-y-2">
              {mapped.map((m) => (
                <div key={m.fieldKey} className="border-b border-zinc-100 pb-2 last:border-0">
                  <span className="text-xs text-zinc-500 uppercase">{m.purpose}</span>
                  <div className="font-medium">{m.displayLabel}</div>
                  {m.purpose === "score" && (
                    <select className="mt-1 rounded border border-zinc-300 px-2 py-1 text-sm">
                      <option>— Select —</option>
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
              ))}
            </div>
          )}
        </div>
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
