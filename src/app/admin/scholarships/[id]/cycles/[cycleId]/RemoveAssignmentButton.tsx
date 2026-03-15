"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RemoveAssignmentButton({
  cycleId,
  userId,
}: {
  cycleId: string;
  userId: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleRemove() {
    if (!confirm("Remove this reviewer from the cycle?")) return;
    setLoading(true);
    try {
      await fetch(
        `/api/admin/assignments?cycleId=${cycleId}&userId=${userId}`,
        { method: "DELETE" }
      );
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleRemove}
      disabled={loading}
      className="text-sm text-red-600 hover:underline disabled:opacity-50"
    >
      Remove
    </button>
  );
}
