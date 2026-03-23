"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  adminInlinePanelClass,
  adminPrimaryButtonSmClass,
  adminSecondaryButtonSmClass,
} from "@/components/admin/actionStyles";

export function RenameCycleForm({
  cycleId,
  currentKey,
  currentLabel,
}: {
  cycleId: string;
  currentKey: string;
  currentLabel: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [cycleKey, setCycleKey] = useState(currentKey);
  const [cycleLabel, setCycleLabel] = useState(currentLabel);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/cycles/${cycleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cycleKey: cycleKey.trim(), cycleLabel: cycleLabel.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to save");
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setError("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setCycleKey(currentKey);
    setCycleLabel(currentLabel);
    setError("");
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={adminSecondaryButtonSmClass}
      >
        Rename
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className={`w-full max-w-xl space-y-3 ${adminInlinePanelClass}`}>
      <div>
        <label className="block text-sm font-medium text-zinc-700">Key</label>
        <input
          type="text"
          value={cycleKey}
          onChange={(e) => setCycleKey(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") handleCancel(); }}
          className="mt-1 block w-full max-w-xs rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
          placeholder="e.g. 2026"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-zinc-700">Label</label>
        <input
          type="text"
          value={cycleLabel}
          onChange={(e) => setCycleLabel(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Escape") handleCancel(); }}
          className="mt-1 block w-full max-w-xs rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
          placeholder="e.g. Fall 2026"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={saving || (cycleKey === currentKey && cycleLabel === currentLabel)}
          className={adminPrimaryButtonSmClass}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={handleCancel}
          className={adminSecondaryButtonSmClass}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
