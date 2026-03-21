"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RenameCycleForm({
  cycleId,
  programId,
  currentKey,
  currentLabel,
}: {
  cycleId: string;
  programId: string;
  currentKey: string;
  currentLabel: string;
}) {
  const router = useRouter();
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
      router.refresh();
    } catch {
      setError("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div>
        <label className="block text-sm font-medium text-zinc-700">Key</label>
        <input
          type="text"
          value={cycleKey}
          onChange={(e) => setCycleKey(e.target.value)}
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
          className="mt-1 block w-full max-w-xs rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
          placeholder="e.g. Fall 2026"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={saving || (cycleKey === currentKey && cycleLabel === currentLabel)}
        className="rounded border border-zinc-300 px-2 py-1 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
