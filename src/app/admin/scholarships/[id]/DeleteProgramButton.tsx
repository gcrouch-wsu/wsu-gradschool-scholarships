"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  adminDangerPanelClass,
  adminDestructiveButtonClass,
  adminDestructiveButtonSmClass,
  adminSecondaryButtonClass,
} from "@/components/admin/actionStyles";

export function DeleteProgramButton({
  programId,
  programName,
}: {
  programId: string;
  programName: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function handleDelete() {
    setDeleting(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/programs/${programId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to delete scholarship");
        return;
      }
      router.push("/admin/scholarships");
      router.refresh();
    } catch {
      setError("Failed to delete scholarship");
    } finally {
      setDeleting(false);
    }
  }

  if (confirming) {
    return (
      <div className={adminDangerPanelClass}>
        <p className="text-sm font-medium text-red-900">
          Delete &quot;{programName}&quot;? This removes every cycle, reviewer assignment, and intake form under this scholarship.
        </p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            className={adminDestructiveButtonClass}
          >
            {deleting ? "Deleting..." : "Delete scholarship"}
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirming(false);
              setError("");
            }}
            disabled={deleting}
            className={adminSecondaryButtonClass}
          >
            Cancel
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className={adminDestructiveButtonSmClass}
    >
      Delete scholarship
    </button>
  );
}
