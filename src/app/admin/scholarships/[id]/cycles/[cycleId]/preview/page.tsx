import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { canManageCycle } from "@/lib/admin";
import { decrypt } from "@/lib/encryption";
import { PreviewNomineeList } from "./PreviewNomineeList";
import { PreviewScoreForm } from "./PreviewScoreForm";
import { getSheetRows } from "@/lib/smartsheet";

export default async function PreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; cycleId: string }>;
  searchParams: Promise<{ row?: string }>;
}) {
  const { id: programId, cycleId } = await params;
  const { row: rowParam } = await searchParams;
  const user = await getSessionUser();
  if (!user) return null;

  const canManage = await canManageCycle(user.id, user.is_platform_admin, cycleId);
  if (!canManage) {
    return (
      <div className="text-zinc-600">You do not have permission to view this cycle.</div>
    );
  }

  const { rows: cycles } = await query<{
    cycle_label: string;
    sheet_id: number | null;
    connection_id: string | null;
  }>(
    "SELECT cycle_label, sheet_id, connection_id FROM scholarship_cycles WHERE id = $1 AND program_id = $2",
    [cycleId, programId]
  );
  const cycle = cycles[0];
  if (!cycle) notFound();

  if (!cycle.sheet_id || !cycle.connection_id) {
    return (
      <div>
        <Link
          href={`/admin/scholarships/${programId}/cycles/${cycleId}`}
          className="text-sm text-zinc-600 hover:underline"
        >
          ← Back to cycle
        </Link>
        <p className="mt-4 text-zinc-600">
          This cycle is not yet configured. Connect a Smartsheet first.
        </p>
      </div>
    );
  }

  const { rows: fieldCheck } = await query<{ id: string }>(
    "SELECT id FROM field_configs WHERE cycle_id = $1 LIMIT 1",
    [cycleId]
  );
  if (fieldCheck.length === 0) {
    return (
      <div>
        <Link
          href={`/admin/scholarships/${programId}/cycles/${cycleId}`}
          className="text-sm text-zinc-600 hover:underline"
        >
          ← Back to cycle
        </Link>
        <p className="mt-4 text-zinc-600">
          Field mapping is not configured yet. Complete the builder setup first.
        </p>
      </div>
    );
  }

  const rowId = rowParam ? parseInt(rowParam, 10) : null;
  const showDetail = rowId != null && !isNaN(rowId);

  if (!showDetail) {
    const { rows: connRows } = await query<{ encrypted_credentials: string }>(
      "SELECT encrypted_credentials FROM connections WHERE id = $1",
      [cycle.connection_id]
    );
    const encryptedCredentials = connRows[0]?.encrypted_credentials;
    if (encryptedCredentials) {
      try {
        const token = decrypt(encryptedCredentials);
        const result = await getSheetRows(token, cycle.sheet_id);
        const firstRowId = result.ok ? result.rows?.[0]?.id : null;
        if (firstRowId != null) {
          redirect(
            `/admin/scholarships/${programId}/cycles/${cycleId}/preview?row=${firstRowId}`
          );
        }
      } catch {
        // Fall through to the list view if preview auto-entry cannot be resolved.
      }
    }
  }

  return (
    <div>
      <Link
        href={`/admin/scholarships/${programId}/cycles/${cycleId}`}
        className="text-sm text-zinc-600 hover:underline"
      >
        ← {cycle.cycle_label}
      </Link>
      <h1 className="mt-4 text-2xl font-semibold text-zinc-900">
        Preview as reviewer
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        See what reviewers will see. Select a role to simulate. No changes are saved.
      </p>

      {showDetail ? (
        <PreviewScoreForm
          cycleId={cycleId}
          rowId={rowId}
          programId={programId}
          cycleLabel={cycle.cycle_label}
        />
      ) : (
        <PreviewNomineeList
          cycleId={cycleId}
          programId={programId}
          cycleLabel={cycle.cycle_label}
        />
      )}
    </div>
  );
}
