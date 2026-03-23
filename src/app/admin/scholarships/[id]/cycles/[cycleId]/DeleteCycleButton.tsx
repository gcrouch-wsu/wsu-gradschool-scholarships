"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  adminDangerPanelClass,
  adminDestructiveButtonClass,
  adminDestructiveButtonSmClass,
  adminSecondaryButtonClass,
  adminSecondaryButtonSmClass,
} from "@/components/admin/actionStyles";

export function DeleteCycleButton({
  cycleId,
  programId,
  cycleLabel,
  compact = false,
}: {
  cycleId: string;
  programId: string;
  cycleLabel: string;
  compact?: boolean;
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
      <div className={compact ? `${adminDangerPanelClass} flex flex-wrap items-center gap-2 p-3` : `mt-6 ${adminDangerPanelClass}`}>
        {compact && (
          <span className="text-xs font-medium text-red-800">
            Delete &quot;{cycleLabel}&quot;?
          </span>
        )}
        {!compact && (
          <p className="mb-2 text-sm font-medium text-red-900">
            Delete &quot;{cycleLabel}&quot;? This cannot be undone. All field config, roles, and assignments will be removed.
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className={compact ? adminDestructiveButtonSmClass : adminDestructiveButtonClass}
          >
            {deleting ? "Deleting…" : compact ? "Delete" : "Delete cycle"}
          </button>
          <button
            type="button"
            onClick={() => { setConfirming(false); setError(""); }}
            disabled={deleting}
            className={compact ? adminSecondaryButtonSmClass : adminSecondaryButtonClass}
          >
            Cancel
          </button>
        </div>
        {error && <p className={compact ? "basis-full text-sm text-red-600" : "mt-2 text-sm text-red-600"}>{error}</p>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className={adminDestructiveButtonSmClass}
    >
      {compact ? "Delete" : "Delete cycle"}
    </button>
  );
}
