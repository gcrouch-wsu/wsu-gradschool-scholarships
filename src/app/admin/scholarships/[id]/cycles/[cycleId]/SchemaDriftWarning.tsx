"use client";

import { useEffect, useState } from "react";

interface DriftedColumn {
  fieldKey: string;
  columnId: number;
  columnTitle: string;
  displayLabel: string;
}

export function SchemaDriftWarning({ cycleId }: { cycleId: string }) {
  const [drift, setDrift] = useState<{
    ok: boolean;
    error?: string;
    driftedColumns: DriftedColumn[];
  } | null>(null);

  useEffect(() => {
    fetch(`/api/admin/cycles/${cycleId}/schema-drift`)
      .then((r) => r.json())
      .then(setDrift)
      .catch(() => setDrift({ ok: false, driftedColumns: [] }));
  }, [cycleId]);

  if (!drift || drift.driftedColumns.length === 0) return null;

  return (
    <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
      <h3 className="font-medium text-amber-900">Schema drift detected</h3>
      <p className="mt-1 text-sm text-amber-800">
        The following mapped columns no longer exist in the live Smartsheet sheet. Re-import the
        schema and update field mappings to fix.
      </p>
      <ul className="mt-2 list-inside list-disc text-sm text-amber-800">
        {drift.driftedColumns.map((c) => (
          <li key={c.fieldKey}>
            {c.displayLabel} (column ID {c.columnId}
            {c.columnTitle ? `, was "${c.columnTitle}"` : ""})
          </li>
        ))}
      </ul>
    </div>
  );
}
