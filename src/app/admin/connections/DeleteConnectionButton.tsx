"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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

  async function handleDelete() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/connections/${connectionId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error ?? "Delete failed");
        return;
      }
      router.refresh();
    } catch {
      alert("An error occurred");
    } finally {
      setLoading(false);
      setConfirming(false);
    }
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-amber-700">Delete &quot;{connectionName}&quot;?</span>
        <button
          type="button"
          onClick={handleDelete}
          disabled={loading}
          className="rounded border border-red-300 bg-red-50 px-2 py-1 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
        >
          {loading ? "Deleting…" : "Yes, delete"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={loading}
          className="rounded border border-zinc-300 px-2 py-1 text-sm hover:bg-zinc-50 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="rounded border border-zinc-300 px-2 py-1 text-sm text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
    >
      Delete
    </button>
  );
}
