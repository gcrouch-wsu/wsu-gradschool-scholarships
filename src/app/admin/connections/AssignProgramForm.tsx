"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AssignProgramForm({
  connectionId,
  connectionName,
  currentProgramId,
  programs,
}: {
  connectionId: string;
  connectionName: string;
  currentProgramId: string | null;
  programs: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [programId, setProgramId] = useState(currentProgramId ?? "");
  const [loading, setLoading] = useState(false);

  async function handleAssign() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/connections/${connectionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programId: programId || null }),
      });
      if (!res.ok) {
        const d = await res.json();
        alert(d.error ?? "Failed to assign");
        return;
      }
      router.refresh();
    } catch {
      alert("Failed to assign");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={programId}
        onChange={(e) => setProgramId(e.target.value)}
        className="rounded-md border border-zinc-300 px-2 py-1 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
        title={`Assign ${connectionName} to program`}
      >
        <option value="">— Unassigned (platform only) —</option>
        {programs.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={handleAssign}
        disabled={loading || programId === (currentProgramId ?? "")}
        className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50"
      >
        {loading ? "…" : "Assign"}
      </button>
    </div>
  );
}
