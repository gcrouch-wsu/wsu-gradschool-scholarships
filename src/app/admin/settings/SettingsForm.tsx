"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SettingsForm({
  idleSessionTimeout,
  sessionWarning,
  smartsheetWriteTimeout,
}: {
  idleSessionTimeout: number;
  sessionWarning: number;
  smartsheetWriteTimeout: number;
}) {
  const router = useRouter();
  const [idle, setIdle] = useState(idleSessionTimeout.toString());
  const [warning, setWarning] = useState(sessionWarning.toString());
  const [write, setWrite] = useState(smartsheetWriteTimeout.toString());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/app-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idle_session_timeout_minutes: parseInt(idle, 10),
          session_warning_minutes: parseInt(warning, 10),
          smartsheet_write_timeout_seconds: parseInt(write, 10),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data.details?.length
          ? data.details.join("; ")
          : data.error ?? "Failed to save";
        setError(msg);
        return;
      }
      router.refresh();
    } catch {
      setError("An error occurred");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md space-y-4 rounded-lg border border-zinc-200 bg-white p-6">
      <div>
        <label className="block text-sm font-medium text-zinc-700">
          Idle session timeout (minutes)
        </label>
        <input
          type="number"
          min={15}
          max={480}
          value={idle}
          onChange={(e) => setIdle(e.target.value)}
          className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
        />
        <p className="mt-1 text-xs text-zinc-500">15–480 minutes. Default 120.</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-zinc-700">
          Session warning before expiry (minutes)
        </label>
        <input
          type="number"
          min={1}
          max={60}
          value={warning}
          onChange={(e) => setWarning(e.target.value)}
          className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
        />
        <p className="mt-1 text-xs text-zinc-500">1–60 minutes. Default 10.</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-zinc-700">
          Smartsheet write timeout (seconds)
        </label>
        <input
          type="number"
          min={15}
          max={60}
          value={write}
          onChange={(e) => setWrite(e.target.value)}
          className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
        />
        <p className="mt-1 text-xs text-zinc-500">15–60 seconds. Default 30.</p>
      </div>
      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
      <button
        type="button"
        onClick={handleSave}
        disabled={loading}
        className="rounded-md bg-[var(--wsu-crimson)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--wsu-crimson-hover)] disabled:opacity-50"
      >
        {loading ? "Saving…" : "Save"}
      </button>
    </div>
  );
}
