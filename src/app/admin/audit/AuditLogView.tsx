"use client";

import { useEffect, useState } from "react";

interface Entry {
  id: string;
  actor_user_id: string | null;
  cycle_id: string | null;
  action_type: string;
  target_type: string | null;
  target_id: string | null;
  metadata_json: unknown;
  created_at: string;
  actor_email: string | null;
  actor_name: string | null;
  cycle_label: string | null;
}

export function AuditLogView({
  cycles,
  actionTypes,
}: {
  cycles: { id: string; cycle_label: string; program_name: string }[];
  actionTypes: string[];
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionType, setActionType] = useState("");
  const [cycleId, setCycleId] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      const params = new URLSearchParams();
      if (actionType) params.set("actionType", actionType);
      if (cycleId) params.set("cycleId", cycleId);
      const res = await fetch(`/api/admin/audit?${params}`);
      const data = await res.json();
      setEntries(data.entries ?? []);
      setLoading(false);
    }
    load();
  }, [actionType, cycleId]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-3">
        <select
          value={actionType}
          onChange={(e) => setActionType(e.target.value)}
          className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
        >
          <option value="">All actions</option>
          {actionTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={cycleId}
          onChange={(e) => setCycleId(e.target.value)}
          className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
        >
          <option value="">All cycles</option>
          {cycles.map((c) => (
            <option key={c.id} value={c.id}>
              {c.program_name} – {c.cycle_label}
            </option>
          ))}
        </select>
      </div>
      {loading ? (
        <p className="text-zinc-500">Loading…</p>
      ) : (
        <div className="overflow-x-auto rounded border border-zinc-200 bg-white">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-200 bg-zinc-50">
                <th className="px-4 py-2 text-left font-medium text-zinc-700">Time</th>
                <th className="px-4 py-2 text-left font-medium text-zinc-700">Action</th>
                <th className="px-4 py-2 text-left font-medium text-zinc-700">Actor</th>
                <th className="px-4 py-2 text-left font-medium text-zinc-700">Cycle</th>
                <th className="px-4 py-2 text-left font-medium text-zinc-700">Target</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-zinc-100">
                  <td className="px-4 py-2 text-zinc-600">
                    {new Date(e.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 font-medium">{e.action_type}</td>
                  <td className="px-4 py-2 text-zinc-600">
                    {e.actor_name ?? e.actor_email ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-zinc-600">{e.cycle_label ?? "—"}</td>
                  <td className="px-4 py-2 text-zinc-600">
                    {e.target_type && e.target_id
                      ? `${e.target_type}:${e.target_id.slice(0, 8)}…`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {entries.length === 0 && (
            <p className="p-4 text-center text-zinc-500">No entries</p>
          )}
        </div>
      )}
    </div>
  );
}
