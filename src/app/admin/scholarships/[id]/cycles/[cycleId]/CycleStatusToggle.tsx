"use client";

import { useRouter } from "next/navigation";

interface CycleStatusToggleProps {
  cycleId: string;
  status: string;
}

export function CycleStatusToggle({ cycleId, status }: CycleStatusToggleProps) {
  const router = useRouter();
  const isActive = status === "active";

  async function handleChange(checked: boolean) {
    const newStatus = checked ? "active" : "draft";
    const res = await fetch(`/api/admin/cycles/${cycleId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (res.ok) router.refresh();
  }

  return (
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={isActive}
        onChange={(e) => handleChange(e.target.checked)}
        className="rounded border-zinc-300"
      />
      <span className="text-sm">
        Active (reviewers can see this cycle)
      </span>
    </label>
  );
}
