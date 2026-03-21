"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface Template {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export function ApplyTemplateForm({ cycleId }: { cycleId: string }) {
  const router = useRouter();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/templates")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setTemplates(data);
      })
      .catch(() => {});
  }, []);

  if (templates.length === 0) return null;

  async function handleApply() {
    if (!selectedId) return;
    setError("");
    setLoading(true);
    try {
      const configRes = await fetch(`/api/admin/templates/${selectedId}`);
      if (!configRes.ok) {
        setError("Failed to load template");
        return;
      }
      const config = await configRes.json();
      const res = await fetch(`/api/admin/cycles/${cycleId}/import-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Import failed");
        return;
      }
      setSelectedId("");
      router.refresh();
    } catch {
      setError("Apply failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-4 rounded border border-zinc-200 bg-zinc-50 p-4">
      <h3 className="text-sm font-medium text-zinc-900">Apply template</h3>
      <p className="mt-1 text-xs text-zinc-600">
        Apply a saved template to this cycle. This replaces all roles, field mappings, and layout.
        The target sheet should have the same column structure as the template source.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
        >
          <option value="">— Select template —</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => {
            if (confirm("Apply will replace all current config. Continue?")) handleApply();
          }}
          disabled={loading || !selectedId}
          className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-white disabled:opacity-50"
        >
          {loading ? "Applying…" : "Apply template"}
        </button>
        {error && <span className="text-sm text-red-600">{error}</span>}
      </div>
    </div>
  );
}
