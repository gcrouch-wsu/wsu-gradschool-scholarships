import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { getReviewerNominees } from "@/lib/reviewer";

export default async function ReviewerCyclePage({
  params,
}: {
  params: Promise<{ cycleId: string }>;
}) {
  const { cycleId } = await params;
  const user = await getSessionUser();
  if (!user) return null;
  if (user.must_change_password) return null;

  const { rows } = await query<{
    cycle_id: string;
    program_name: string;
    cycle_label: string;
    role_label: string;
    sheet_id: number | null;
    connection_id: string | null;
  }>(
    `SELECT c.id as cycle_id, p.name as program_name, c.cycle_label, r.label as role_label, c.sheet_id, c.connection_id
     FROM scholarship_memberships m
     JOIN scholarship_cycles c ON c.id = m.cycle_id
     JOIN scholarship_programs p ON p.id = c.program_id
     JOIN roles r ON r.id = m.role_id
     WHERE m.user_id = $1 AND m.cycle_id = $2 AND m.status = 'active' AND c.status = 'active'`,
    [user.id, cycleId]
  );
  const assignment = rows[0];
  if (!assignment) notFound();

  if (!assignment.sheet_id || !assignment.connection_id) {
    return (
      <div>
        <Link href="/reviewer" className="text-sm text-zinc-600 hover:underline">
          ← My scholarships
        </Link>
        <h1 className="mt-4 text-2xl font-semibold text-zinc-900">
          {assignment.program_name} – {assignment.cycle_label}
        </h1>
        <p className="mt-4 text-zinc-600">
          This cycle is not yet configured. The admin must connect a Smartsheet and configure fields before you can review.
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
        <Link href="/reviewer" className="text-sm text-zinc-600 hover:underline">
          ← My scholarships
        </Link>
        <h1 className="mt-4 text-2xl font-semibold text-zinc-900">
          {assignment.program_name} – {assignment.cycle_label}
        </h1>
        <p className="mt-4 text-zinc-600">
          Field mapping is not configured yet. The admin must complete the builder setup.
        </p>
      </div>
    );
  }

  const { rows: progressRows } = await query<{ last_row_id: number | null }>(
    "SELECT last_row_id FROM user_cycle_progress WHERE user_id = $1 AND cycle_id = $2",
    [user.id, cycleId]
  );
  const lastRowId = progressRows[0]?.last_row_id ?? null;

  return (
    <div>
      <Link href="/reviewer" className="text-sm text-zinc-600 hover:underline">
        ← My scholarships
      </Link>
      <h1 className="mt-4 text-2xl font-semibold text-zinc-900">
        {assignment.program_name} – {assignment.cycle_label}
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        You are reviewing as {assignment.role_label}
      </p>
      {lastRowId && (
        <Link
          href={`/reviewer/${cycleId}/nominees/${lastRowId}`}
          className="mt-4 inline-block rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          Continue where you left off
        </Link>
      )}
      <NomineeList cycleId={cycleId} userId={user.id} />
    </div>
  );
}

async function NomineeList({ cycleId, userId }: { cycleId: string; userId: string }) {
  const rows = await getReviewerNominees(userId, cycleId);
  if (rows === null) {
    return (
      <div className="mt-6 rounded border border-amber-200 bg-amber-50 p-4 text-amber-900">
        Could not load nominees. Please try again.
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="mt-6 text-zinc-600">
        No nominees in this cycle.
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-2">
      <h2 className="font-medium text-zinc-900">Nominees</h2>
      <ul className="divide-y divide-zinc-200 rounded border border-zinc-200 bg-white">
        {rows.map((n) => (
          <li key={n.id}>
            <Link
              href={`/reviewer/${cycleId}/nominees/${n.id}`}
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
