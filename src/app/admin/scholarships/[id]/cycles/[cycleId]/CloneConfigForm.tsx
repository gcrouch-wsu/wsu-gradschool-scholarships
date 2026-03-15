"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface CycleOption {
  id: string;
  cycle_key: string;
  cycle_label: string;
}

export function CloneConfigForm({
  cycleId,
  sourceCycles,
}: {
  cycleId: string;
  sourceCycles: CycleOption[];
}) {
  const router = useRouter();
  const [sourceCycleId, setSourceCycleId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const options = sourceCycles.filter((c) => c.id !== cycleId);

  if (options.length === 0) return null;

  async function handleClone() {
    if (!sourceCycleId) return;
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/cycles/${cycleId}/clone-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceCycleId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Clone failed");
        return;
      }
      setSourceCycleId("");
      router.refresh();
    } catch {
      setError("An error occurred");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-4 rounded border border-zinc-200 bg-zinc-50 p-4">
      <h3 className="text-sm font-medium text-zinc-900">Copy config from prior cycle</h3>
      <p className="mt-1 text-xs text-zinc-600">
        Copy roles, field mappings, and layout from another cycle in this program.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={sourceCycleId}
          onChange={(e) => setSourceCycleId(e.target.value)}
          className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
        >
          <option value="">— Select cycle —</option>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.cycle_label} ({c.cycle_key})
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleClone}
          disabled={loading || !sourceCycleId}
          className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-white disabled:opacity-50"
        >
          {loading ? "Copying…" : "Copy config"}
        </button>
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </div>
  );
}
