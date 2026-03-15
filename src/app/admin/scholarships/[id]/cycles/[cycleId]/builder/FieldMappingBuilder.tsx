"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const PURPOSES = [
  { value: "identity", label: "Identity", desc: "Primary identifier (e.g. name)" },
  { value: "subtitle", label: "Subtitle", desc: "Secondary identifier" },
  { value: "narrative", label: "Narrative", desc: "Read-only narrative text" },
  { value: "score", label: "Score", desc: "Reviewer selects from options" },
  { value: "comments", label: "Comments", desc: "Reviewer writes comments" },
  { value: "metadata", label: "Metadata", desc: "Other read-only fields" },
  { value: "attachment", label: "Attachment", desc: "Read-only attachment list" },
] as const;

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
        purpose: isAttachment ? "attachment" : "metadata",
        displayLabel: col.title,
        displayType: isAttachment ? "attachment_list" : "short_text",
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
          Add columns from your sheet and assign each a purpose. Identity, narrative, score, and comments are used by the reviewer runtime.
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

        <p className="mb-2 text-xs text-zinc-500">
          Drag to reorder. Order determines display in reviewer layout.
        </p>
        <div className="space-y-2">
          {mapped.map((m, idx) => (
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
              className="flex cursor-grab flex-wrap items-center gap-2 rounded border border-zinc-200 bg-zinc-50 p-3 active:cursor-grabbing"
            >
              <span className="font-medium text-zinc-700">{m.sourceColumnTitle}</span>
              <select
                value={m.purpose}
                onChange={(e) =>
                  updateMapping(idx, {
                    purpose: e.target.value,
                    displayType: DISPLAY_TYPES[e.target.value] || m.displayType,
                  })
                }
                className="rounded border border-zinc-300 px-2 py-1 text-sm"
              >
                {PURPOSES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={m.displayLabel}
                onChange={(e) => updateMapping(idx, { displayLabel: e.target.value })}
                placeholder="Display label"
                className="rounded border border-zinc-300 px-2 py-1 text-sm"
              />
              <button
                type="button"
                onClick={() => removeMapping(idx)}
                className="text-sm text-red-600 hover:underline"
              >
                Remove
              </button>
            </div>
          ))}
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
