"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminSecondaryButtonSmClass } from "@/components/admin/actionStyles";

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
  const [error, setError] = useState("");

  async function handleAssign() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/connections/${connectionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ programId: programId || null }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? "Failed to assign");
        return;
      }
      router.refresh();
    } catch {
      setError("Failed to assign");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={programId}
        onChange={(e) => setProgramId(e.target.value)}
        className="min-w-[220px] rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
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
        className={adminSecondaryButtonSmClass}
      >
        {loading ? "…" : "Assign"}
      </button>
      {error && <span className="basis-full text-xs text-red-600">{error}</span>}
    </div>
  );
}
