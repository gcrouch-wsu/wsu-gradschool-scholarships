"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteCycleButton({
  cycleId,
  programId,
  cycleLabel,
}: {
  cycleId: string;
  programId: string;
  cycleLabel: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function handleDelete() {
    setError("");
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/cycles/${cycleId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to delete");
        return;
      }
      router.push(`/admin/scholarships/${programId}`);
      router.refresh();
    } catch {
      setError("Failed to delete");
    } finally {
      setDeleting(false);
    }
  }

  if (confirming) {
    return (
      <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4">
        <p className="mb-2 text-sm font-medium text-red-900">
          Delete &quot;{cycleLabel}&quot;? This cannot be undone. All field config, roles, and assignments will be removed.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete cycle"}
          </button>
          <button
            type="button"
            onClick={() => { setConfirming(false); setError(""); }}
            disabled={deleting}
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Cancel
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="text-sm text-red-600 hover:underline"
    >
      Delete cycle
    </button>
  );
}
