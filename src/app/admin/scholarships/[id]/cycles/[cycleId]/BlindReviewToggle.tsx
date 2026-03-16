"use client";

import { useRouter } from "next/navigation";

interface BlindReviewToggleProps {
  cycleId: string;
  blindReview: boolean;
}

export function BlindReviewToggle({ cycleId, blindReview }: BlindReviewToggleProps) {
  const router = useRouter();

  async function handleChange(checked: boolean) {
    const res = await fetch(`/api/admin/cycles/${cycleId}/view-settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blindReview: checked }),
    });
    if (res.ok) router.refresh();
  }

  return (
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={blindReview}
        onChange={(e) => handleChange(e.target.checked)}
        className="rounded border-zinc-300"
      />
      <span className="text-sm">
        Blind review (hide nominee names to reduce bias)
      </span>
    </label>
  );
}
