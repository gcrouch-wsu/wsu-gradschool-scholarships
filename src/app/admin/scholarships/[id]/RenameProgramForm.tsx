"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RenameProgramForm({
  programId,
  initialName,
  initialDescription,
}: {
  programId: string;
  initialName: string;
  initialDescription: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    if (!name.trim()) { setError("Name is required"); return; }
    setError("");
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/programs/${programId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? "Failed to save");
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setError("An error occurred");
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setName(initialName);
    setDescription(initialDescription ?? "");
    setError("");
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="mt-1 flex items-center gap-1 rounded border border-zinc-300 bg-white px-2 py-0.5 text-xs font-medium text-zinc-600 hover:border-zinc-400 hover:bg-zinc-50"
      >
        ✏ Rename
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded border border-zinc-200 bg-zinc-50 p-3">
      <div>
        <label className="block text-xs font-medium text-zinc-600">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") handleCancel(); }}
          autoFocus
          className="mt-1 block w-full max-w-sm rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-zinc-600">Description (optional)</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") handleCancel(); }}
          placeholder="Leave blank to clear"
          className="mt-1 block w-full max-w-sm rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
        />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded bg-[var(--wsu-crimson)] px-3 py-1 text-xs font-medium text-white hover:bg-[var(--wsu-crimson-hover)] disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={handleCancel}
          className="rounded border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
