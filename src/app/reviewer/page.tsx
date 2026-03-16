import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { query } from "@/lib/db";

export default async function ReviewerPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.must_change_password) redirect("/change-password");

  const { rows: assignments } = await query<{
    cycle_id: string;
    program_id: string;
    program_name: string;
    cycle_label: string;
    cycle_key: string;
    role_label: string;
    status: string;
  }>(
    `SELECT c.id as cycle_id, p.id as program_id, p.name as program_name,
            c.cycle_label, c.cycle_key, r.label as role_label, c.status
     FROM scholarship_memberships m
     JOIN scholarship_cycles c ON c.id = m.cycle_id
     JOIN scholarship_programs p ON p.id = c.program_id
     JOIN roles r ON r.id = m.role_id
     WHERE m.user_id = $1 AND m.status = 'active' AND c.status = 'active'`,
    [user.id]
  );

  const { rows: progressRows } = await query<{
    cycle_id: string;
    last_row_id: number | null;
  }>(
    `SELECT ucp.cycle_id, ucp.last_row_id
     FROM user_cycle_progress ucp
     WHERE ucp.user_id = $1`,
    [user.id]
  );
  const progressByCycle = Object.fromEntries(
    progressRows.map((r) => [r.cycle_id, r.last_row_id])
  );

  const { rows: reviewedCounts } = await query<{
    cycle_id: string;
    reviewed_count: string;
  }>(
    `SELECT cycle_id, COUNT(DISTINCT target_id)::text as reviewed_count
     FROM audit_logs
     WHERE actor_user_id = $1 AND action_type = 'reviewer.score_saved' AND target_id IS NOT NULL AND target_id != ''
     GROUP BY cycle_id`,
    [user.id]
  );
  const reviewedByCycle = Object.fromEntries(
    reviewedCounts.map((r) => [r.cycle_id, parseInt(r.reviewed_count, 10)])
  );

  return (
    <>
      <h1 className="mb-6 text-2xl font-semibold text-zinc-900">
        My scholarships
      </h1>
        {assignments.length === 0 ? (
          <div className="rounded-lg border border-zinc-200 bg-white p-6 text-center">
            <p className="text-zinc-600">
              You are not assigned to any active scholarship cycles.
            </p>
            <p className="mt-2 text-sm text-zinc-500">
              Contact your program administrator if you expect to have access.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {assignments.map((a) => {
              const reviewed = reviewedByCycle[a.cycle_id] ?? 0;
              const hasStarted = progressByCycle[a.cycle_id] != null;
              return (
                <Link
                  key={a.cycle_id}
                  href={`/reviewer/${a.cycle_id}`}
                  className="block rounded-lg border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-zinc-300"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <span className="font-medium text-zinc-900">
                        {a.program_name} – {a.cycle_label}
                      </span>
                      <span className="ml-2 text-sm text-zinc-500">
                        ({a.role_label})
                      </span>
                    </div>
                    {hasStarted && (
                      <span className="shrink-0 rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">
                        {reviewed} reviewed
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
    </>
  );
}
