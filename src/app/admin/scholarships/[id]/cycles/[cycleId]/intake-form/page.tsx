import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { canManageCycle } from "@/lib/admin";
import IntakeFormBuilder from "./IntakeFormBuilder";

export default async function IntakeFormBuilderPage({
  params,
}: {
  params: Promise<{ id: string; cycleId: string }>;
}) {
  const { id: programId, cycleId } = await params;
  const user = await getSessionUser();
  if (!user) return null;

  const canManage = await canManageCycle(user.id, user.is_platform_admin, cycleId);
  if (!canManage) {
    return (
      <div className="text-zinc-600">
        You do not have permission to manage this cycle.
      </div>
    );
  }

  const { rows: programs } = await query<{ name: string }>(
    "SELECT name FROM scholarship_programs WHERE id = $1",
    [programId]
  );
  if (programs.length === 0) notFound();

  const { rows: cycles } = await query<{ cycle_label: string }>(
    "SELECT cycle_label FROM scholarship_cycles WHERE id = $1 AND program_id = $2",
    [cycleId, programId]
  );
  if (cycles.length === 0) notFound();

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center gap-2 text-sm text-zinc-600">
          <Link href={`/admin/scholarships/${programId}`} className="hover:underline">
            {programs[0].name}
          </Link>
          <span>/</span>
          <Link href={`/admin/scholarships/${programId}/cycles/${cycleId}`} className="hover:underline">
            {cycles[0].cycle_label}
          </Link>
        </div>
      </div>

      <IntakeFormBuilder programId={programId} cycleId={cycleId} />
    </div>
  );
}
