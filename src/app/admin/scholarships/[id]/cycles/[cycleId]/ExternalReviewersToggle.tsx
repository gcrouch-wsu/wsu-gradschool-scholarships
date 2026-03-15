"use client";

import { useRouter } from "next/navigation";

interface ExternalReviewersToggleProps {
  cycleId: string;
  allowExternalReviewers: boolean;
}

export function ExternalReviewersToggle({
  cycleId,
  allowExternalReviewers,
}: ExternalReviewersToggleProps) {
  const router = useRouter();

  async function handleChange(checked: boolean) {
    const res = await fetch(`/api/admin/cycles/${cycleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allowExternalReviewers: checked }),
    });
    if (res.ok) router.refresh();
  }

  return (
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={allowExternalReviewers}
        onChange={(e) => handleChange(e.target.checked)}
        className="rounded border-zinc-300"
      />
      <span className="text-sm">
        Allow invited external reviewers (default: WSU-only)
      </span>
    </label>
  );
}
