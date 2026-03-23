"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { adminPrimaryButtonClass } from "@/components/admin/actionStyles";

interface Template {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export function AddCycleForm({ programId }: { programId: string }) {
  const router = useRouter();
  const [cycleKey, setCycleKey] = useState("");
  const [cycleLabel, setCycleLabel] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/admin/templates")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setTemplates(data);
      })
      .catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/cycles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          programId,
          cycleKey: cycleKey.trim(),
          cycleLabel: cycleLabel.trim() || cycleKey.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create cycle");
        return;
      }
      const cycleId = data.id;
      if (templateId && cycleId) {
        const configRes = await fetch(`/api/admin/templates/${templateId}`);
        if (!configRes.ok) {
          const configErr = await configRes.json();
          const errMsg = configErr.error ?? "Failed to load template";
          router.push(`/admin/scholarships/${programId}/cycles/${cycleId}?templateError=${encodeURIComponent(errMsg)}`);
          return;
        }
        const config = await configRes.json();
        const importRes = await fetch(`/api/admin/cycles/${cycleId}/import-config`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(config),
        });
        if (!importRes.ok) {
          const importErr = await importRes.json();
          const errMsg = importErr.error ?? "Failed to apply template";
          router.push(`/admin/scholarships/${programId}/cycles/${cycleId}?templateError=${encodeURIComponent(errMsg)}`);
          return;
        }
      }
      setCycleKey("");
      setCycleLabel("");
      setTemplateId("");
      router.refresh();
    } catch {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
      <div>
        <label htmlFor="cycleKey" className="block text-xs font-medium text-zinc-600">
          Cycle key
        </label>
        <input
          id="cycleKey"
          type="text"
          value={cycleKey}
          onChange={(e) => setCycleKey(e.target.value)}
          placeholder="2026"
          required
          className="mt-1 rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
        />
      </div>
      <div>
        <label htmlFor="cycleLabel" className="block text-xs font-medium text-zinc-600">
          Cycle label
        </label>
        <input
          id="cycleLabel"
          type="text"
          value={cycleLabel}
          onChange={(e) => setCycleLabel(e.target.value)}
          placeholder="2026"
          className="mt-1 rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
        />
      </div>
      {templates.length > 0 && (
        <div>
          <label htmlFor="template" className="block text-xs font-medium text-zinc-600">
            Apply template (optional)
          </label>
          <select
            id="template"
            value={templateId}
            onChange={(e) => setTemplateId(e.target.value)}
            className="mt-1 rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
          >
            <option value="">— None —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <button
        type="submit"
        disabled={loading}
        className={adminPrimaryButtonClass}
      >
        {loading ? "Adding…" : "Add cycle"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
