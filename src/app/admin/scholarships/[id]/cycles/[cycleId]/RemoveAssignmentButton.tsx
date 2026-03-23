"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminDestructiveButtonSmClass } from "@/components/admin/actionStyles";

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
      className={adminDestructiveButtonSmClass}
    >
      Remove
    </button>
  );
}
