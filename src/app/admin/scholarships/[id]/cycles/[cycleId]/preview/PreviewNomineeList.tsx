"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface Nominee {
  id: number;
  displayName: string;
  identity: Record<string, unknown>;
}

export function PreviewNomineeList({
  cycleId,
  programId,
  cycleLabel,
}: {
  cycleId: string;
  programId: string;
  cycleLabel: string;
}) {
  const [rows, setRows] = useState<Nominee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/cycles/${cycleId}/preview-rows`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to load");
        return;
      }
      setRows(data.rows ?? []);
    } catch {
      setError("Failed to load");
    } finally {
      setLoading(false);
    }
  }, [cycleId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <div className="mt-6 text-zinc-500">Loading…</div>;
  if (error) {
    return (
      <div className="mt-6 rounded border border-red-200 bg-red-50 p-4 text-red-900">{error}</div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="mt-6 rounded border border-zinc-200 bg-white p-6 text-center text-zinc-600">
        No nominees in this cycle. Connect a sheet and sync to see data.
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-2">
      <h2 className="font-medium text-zinc-900">Nominees (preview)</h2>
      <ul className="divide-y divide-zinc-200 rounded border border-zinc-200 bg-white">
        {rows.map((n) => (
          <li key={n.id}>
            <Link
              href={`/admin/scholarships/${programId}/cycles/${cycleId}/preview?row=${n.id}`}
              className="block px-4 py-3 hover:bg-zinc-50"
            >
              {n.displayName}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
