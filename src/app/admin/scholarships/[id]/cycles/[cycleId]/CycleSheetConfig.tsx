"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface CycleSheetConfigProps {
  cycleId: string;
  connectionId: string | null;
  sheetId: number | null;
  sheetName: string | null;
  schemaSyncedAt: string | null;
  connections: { id: string; name: string }[];
}

export function CycleSheetConfig({
  cycleId,
  connectionId,
  sheetId,
  sheetName,
  schemaSyncedAt,
  connections,
}: CycleSheetConfigProps) {
  const router = useRouter();
  const [connId, setConnId] = useState(connectionId ?? "");
  const [sheetIdInput, setSheetIdInput] = useState(sheetId?.toString() ?? "");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");

  async function handleSave() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/cycles/${cycleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId: connId || null,
          sheetId: sheetIdInput ? parseInt(sheetIdInput, 10) : null,
          sheetName: sheetName || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to save");
        return;
      }
      router.refresh();
    } catch {
      setError("An error occurred");
    } finally {
      setLoading(false);
    }
  }

  async function handleImportSchema() {
    if (!connId || !sheetIdInput) {
      setError("Select a connection and enter sheet ID");
      return;
    }
    const sid = parseInt(sheetIdInput, 10);
    if (isNaN(sid)) {
      setError("Invalid sheet ID");
      return;
    }
    setError("");
    setSyncing(true);
    try {
      const schemaRes = await fetch(`/api/admin/connections/${connId}/schema`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheetId: sid, cycleId }),
      });
      const schemaData = await schemaRes.json();
      if (!schemaRes.ok) {
        setError(schemaData.error ?? "Failed to fetch schema");
        return;
      }

      const patchRes = await fetch(`/api/admin/cycles/${cycleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId: connId,
          sheetId: sid,
          sheetName: schemaData.sheet?.name ?? sheetName,
          sheetSchemaSnapshot: schemaData.sheet,
          schemaSyncedAt: new Date().toISOString(),
          schemaStatus: "ok",
        }),
      });
      if (!patchRes.ok) {
        setError("Failed to save schema");
        return;
      }
      router.refresh();
    } catch {
      setError("An error occurred");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-3 rounded border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap gap-4">
        <div>
          <label className="block text-xs font-medium text-zinc-600">
            Connection
          </label>
          <select
            value={connId}
            onChange={(e) => setConnId(e.target.value)}
            className="mt-1 rounded border border-zinc-300 px-3 py-2 text-sm"
          >
            <option value="">— Select —</option>
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-600">
            Sheet ID
          </label>
          <input
            type="text"
            value={sheetIdInput}
            onChange={(e) => setSheetIdInput(e.target.value)}
            placeholder="e.g. 123456789"
            className="mt-1 rounded border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
      </div>
      {sheetName && (
        <p className="text-sm text-zinc-500">Sheet: {sheetName}</p>
      )}
      {schemaSyncedAt && (
        <p className="text-xs text-zinc-400">
          Schema synced {new Date(schemaSyncedAt).toLocaleString()}
        </p>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={loading}
          className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-50"
        >
          {loading ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={handleImportSchema}
          disabled={syncing || !connId || !sheetIdInput}
          className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white hover:bg-zinc-800 disabled:opacity-50"
        >
          {syncing ? "Importing…" : "Import schema"}
        </button>
      </div>
    </div>
  );
}
