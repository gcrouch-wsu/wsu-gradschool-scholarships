"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton({ className }: { className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleLogout() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={busy}
      aria-busy={busy}
      className={`disabled:cursor-not-allowed disabled:opacity-50 ${
        className ?? "rounded-sm text-sm text-zinc-600 hover:text-zinc-900"
      }`}
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
