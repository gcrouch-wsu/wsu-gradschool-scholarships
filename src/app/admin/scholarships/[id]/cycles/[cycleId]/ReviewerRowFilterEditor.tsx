"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { adminPrimaryButtonSmClass, adminSecondaryButtonSmClass } from "@/components/admin/actionStyles";

type SheetColumn = { id: number; title: string };

type UiOp = "eq" | "in" | "not_in" | "contains" | "is_empty" | "is_not_empty";

interface UiRule {
  id: string;
  columnId: string;
  op: UiOp;
  value: string;
  valuesCsv: string;
}

const OP_OPTIONS: { value: UiOp; label: string }[] = [
  { value: "eq", label: "Equals" },
  { value: "in", label: "Is one of (comma-separated)" },
  { value: "not_in", label: "Is not one of (comma-separated)" },
  { value: "contains", label: "Contains text" },
  { value: "is_empty", label: "Is empty" },
  { value: "is_not_empty", label: "Is not empty" },
];

function newRuleId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function loadUiRules(criteria: unknown): UiRule[] {
  if (criteria == null || typeof criteria !== "object") return [];
  const rules = (criteria as { rules?: unknown }).rules;
  if (!Array.isArray(rules)) return [];
  return rules
    .map((raw) => {
      if (raw == null || typeof raw !== "object") return null;
      const r = raw as Record<string, unknown>;
      const col = r.columnId;
      const colStr = typeof col === "number" ? String(col) : typeof col === "string" ? col : "";
      const op = r.op;
      if (typeof op !== "string") return null;
      const validOps = new Set(OP_OPTIONS.map((o) => o.value));
      if (!validOps.has(op as UiOp)) return null;
      let value = "";
      let valuesCsv = "";
      if (r.value != null) value = String(r.value);
      if (Array.isArray(r.values)) {
        valuesCsv = r.values.map((v) => String(v)).join(", ");
      }
      return {
        id: newRuleId(),
        columnId: colStr,
        op: op as UiOp,
        value,
        valuesCsv,
      } satisfies UiRule;
    })
    .filter((x): x is UiRule => x != null && x.columnId !== "");
}

function buildFilterPayload(rules: UiRule[]): unknown | null {
  const apiRules = rules
    .filter((r) => r.columnId.trim() !== "")
    .map((r) => {
      const columnId = Number(r.columnId);
      if (!Number.isFinite(columnId)) return null;
      switch (r.op) {
        case "eq":
          return { columnId, op: "eq", value: r.value };
        case "contains":
          return { columnId, op: "contains", value: r.value };
        case "in":
        case "not_in": {
          const values = r.valuesCsv
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          if (values.length === 0) return null;
          return { columnId, op: r.op, values };
        }
        case "is_empty":
          return { columnId, op: "is_empty" };
        case "is_not_empty":
          return { columnId, op: "is_not_empty" };
        default:
          return null;
      }
    })
    .filter((x): x is NonNullable<typeof x> => x != null);

  if (apiRules.length === 0) return null;
  return { rules: apiRules };
}

export function ReviewerRowFilterEditor({
  cycleId,
  userId,
  roleId,
  reviewerLabel,
  initialCriteria,
  sheetColumns,
}: {
  cycleId: string;
  userId: string;
  roleId: string;
  reviewerLabel: string;
  initialCriteria: unknown;
  sheetColumns: SheetColumn[];
}) {
  const router = useRouter();
  const [rules, setRules] = useState<UiRule[]>(() => loadUiRules(initialCriteria));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  const hasFilter = useMemo(
    () => loadUiRules(initialCriteria).length > 0,
    [initialCriteria]
  );

  const columnOptions = useMemo(
    () =>
      [...sheetColumns].sort((a, b) =>
        a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
      ),
    [sheetColumns]
  );

  async function save(next: UiRule[] | null) {
    setError("");
    setSaving(true);
    try {
      const filterCriteria = next === null ? null : buildFilterPayload(next);
      const res = await fetch("/api/admin/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cycleId,
          userId,
          roleId,
          filterCriteria,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Save failed");
        return;
      }
      if (next === null) {
        setRules([]);
      }
      router.refresh();
    } catch {
      setError("Save failed");
    } finally {
      setSaving(false);
    }
  }

  if (columnOptions.length === 0) {
    return (
      <p className="mt-2 text-xs text-amber-800">
        Row filters need sheet columns. Sync the Smartsheet schema for this cycle first.
      </p>
    );
  }

  return (
    <div className="mt-3 border-t border-zinc-100 pt-3 md:col-span-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 rounded-md text-left text-sm font-medium text-zinc-700 hover:text-[var(--wsu-crimson)]"
        aria-expanded={open}
      >
        <span>
          Row visibility filter
          {hasFilter ? (
            <span className="ml-2 font-normal text-zinc-500">(active: restricted rows)</span>
          ) : (
            <span className="ml-2 font-normal text-zinc-500">(all sheet rows)</span>
          )}
        </span>
        <span className="text-zinc-400" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-3 rounded-lg border border-zinc-200 bg-zinc-50/80 p-3">
          <p className="text-xs leading-relaxed text-zinc-600">
            Restrict which Smartsheet rows <strong>{reviewerLabel}</strong> sees. Rules use{" "}
            <strong>numeric column IDs</strong> from your sheet; all rules must match (AND). Empty list
            means no filter.
          </p>

          {rules.length === 0 ? (
            <p className="text-xs text-zinc-500">No rules yet — reviewer sees every row in the sheet.</p>
          ) : (
            <ul className="space-y-3">
              {rules.map((rule) => (
                <li
                  key={rule.id}
                  className="grid gap-2 rounded-md border border-zinc-200 bg-white p-2 sm:grid-cols-2 lg:grid-cols-12 lg:items-end"
                >
                  <div className="lg:col-span-4">
                    <label className="block text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                      Column
                    </label>
                    <select
                      value={rule.columnId}
                      onChange={(e) =>
                        setRules((rs) =>
                          rs.map((r) => (r.id === rule.id ? { ...r, columnId: e.target.value } : r))
                        )
                      }
                      className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                    >
                      <option value="">— Select —</option>
                      {columnOptions.map((c) => (
                        <option key={c.id} value={String(c.id)}>
                          {c.title} (id {c.id})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="lg:col-span-3">
                    <label className="block text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                      Condition
                    </label>
                    <select
                      value={rule.op}
                      onChange={(e) =>
                        setRules((rs) =>
                          rs.map((r) =>
                            r.id === rule.id ? { ...r, op: e.target.value as UiOp } : r
                          )
                        )
                      }
                      className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                    >
                      {OP_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {(rule.op === "eq" || rule.op === "contains") && (
                    <div className="sm:col-span-2 lg:col-span-4">
                      <label className="block text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                        Value
                      </label>
                      <input
                        type="text"
                        value={rule.value}
                        onChange={(e) =>
                          setRules((rs) =>
                            rs.map((r) => (r.id === rule.id ? { ...r, value: e.target.value } : r))
                          )
                        }
                        className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                      />
                    </div>
                  )}
                  {(rule.op === "in" || rule.op === "not_in") && (
                    <div className="sm:col-span-2 lg:col-span-4">
                      <label className="block text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                        Values (comma-separated)
                      </label>
                      <input
                        type="text"
                        value={rule.valuesCsv}
                        onChange={(e) =>
                          setRules((rs) =>
                            rs.map((r) => (r.id === rule.id ? { ...r, valuesCsv: e.target.value } : r))
                          )
                        }
                        className="mt-1 w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
                        placeholder="A, B, C"
                      />
                    </div>
                  )}
                  <div className="flex items-end lg:col-span-1">
                    <button
                      type="button"
                      onClick={() => setRules((rs) => rs.filter((r) => r.id !== rule.id))}
                      className="text-xs font-medium text-red-700 hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setRules((rs) => [
                  ...rs,
                  {
                    id: newRuleId(),
                    columnId: columnOptions[0] ? String(columnOptions[0].id) : "",
                    op: "eq",
                    value: "",
                    valuesCsv: "",
                  },
                ])
              }
              className={adminSecondaryButtonSmClass}
            >
              Add rule
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void save(rules)}
              className={adminPrimaryButtonSmClass}
            >
              {saving ? "Saving…" : "Save filter"}
            </button>
            <button
              type="button"
              disabled={saving || (!hasFilter && rules.length === 0)}
              onClick={() => {
                if (!confirm("Clear all row filters for this reviewer? They will see every row again.")) return;
                void save(null);
              }}
              className={adminSecondaryButtonSmClass}
            >
              Clear filter
            </button>
          </div>
          {error && (
            <p className="text-xs text-red-700" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
