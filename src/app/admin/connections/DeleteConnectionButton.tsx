"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  adminDangerPanelClass,
  adminDestructiveButtonSmClass,
  adminSecondaryButtonSmClass,
} from "@/components/admin/actionStyles";

export function DeleteConnectionButton({
  connectionId,
  connectionName,
}: {
  connectionId: string;
  connectionName: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");

  async function handleDelete() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/connections/${connectionId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Delete failed");
        return;
      }
      setConfirming(false);
      router.refresh();
    } catch {
      setError("An error occurred");
    } finally {
      setLoading(false);
    }
  }

  if (confirming) {
    return (
      <div className={`${adminDangerPanelClass} flex max-w-sm flex-wrap items-center gap-2 p-3`}>
        <span className="text-sm text-amber-700">Delete &quot;{connectionName}&quot;?</span>
        <button
          type="button"
          onClick={handleDelete}
          disabled={loading}
          className={adminDestructiveButtonSmClass}
        >
          {loading ? "Deleting…" : "Yes, delete"}
        </button>
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            setError("");
          }}
          disabled={loading}
          className={adminSecondaryButtonSmClass}
        >
          Cancel
        </button>
        {error && <span className="basis-full text-xs text-red-700">{error}</span>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setError("");
        setConfirming(true);
      }}
      className={adminDestructiveButtonSmClass}
    >
      Delete
    </button>
  );
}
