import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { ReviewerScoreForm } from "./ReviewerScoreForm";

export default async function ReviewerNomineePage({
  params,
}: {
  params: Promise<{ cycleId: string; rowId: string }>;
}) {
  const { cycleId, rowId } = await params;
  const user = await getSessionUser();
  if (!user) return null;
  if (user.must_change_password) return null;

  const rowIdNum = parseInt(rowId, 10);
  if (isNaN(rowIdNum)) notFound();

  const { rows } = await query<{
    program_name: string;
    cycle_label: string;
    role_label: string;
  }>(
    `SELECT p.name as program_name, c.cycle_label, r.label as role_label
     FROM scholarship_memberships m
     JOIN scholarship_cycles c ON c.id = m.cycle_id
     JOIN scholarship_programs p ON p.id = c.program_id
     JOIN roles r ON r.id = m.role_id
     WHERE m.user_id = $1 AND m.cycle_id = $2 AND m.status = 'active' AND c.status = 'active'`,
    [user.id, cycleId]
  );
  const assignment = rows[0];
  if (!assignment) notFound();

  return (
    <div>
      <Link
        href={`/reviewer/${cycleId}`}
        className="text-sm text-zinc-600 hover:underline"
      >
        ← {assignment.program_name} – {assignment.cycle_label}
      </Link>
      <h1 className="mt-4 text-2xl font-semibold text-zinc-900">
        Review nominee
      </h1>
      <p className="mt-1 text-sm text-zinc-500">
        As {assignment.role_label}
      </p>
      <ReviewerScoreForm cycleId={cycleId} rowId={rowIdNum} />
    </div>
  );
}
