import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { canManageProgram } from "@/lib/admin";
import { query } from "@/lib/db";
import { AddCycleForm } from "./AddCycleForm";
import { DeleteProgramButton } from "./DeleteProgramButton";
import { ProgramAdminsSection } from "./ProgramAdminsSection";
import { DeleteCycleButton } from "./cycles/[cycleId]/DeleteCycleButton";

export default async function ProgramDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) return null;
  const canManage = await canManageProgram(user.id, user.is_platform_admin, id);
  if (!canManage) {
    return (
      <div className="text-zinc-600">
        You do not have permission to view this program.
      </div>
    );
  }

  const { rows: programs } = await query<{
    id: string;
    slug: string;
    name: string;
    description: string | null;
    status: string;
  }>("SELECT id, slug, name, description, status FROM scholarship_programs WHERE id = $1", [
    id,
  ]);
  const program = programs[0];
  if (!program) notFound();

  const { rows: cycles } = await query<{
    id: string;
    cycle_key: string;
    cycle_label: string;
    status: string;
    sheet_id: number | null;
    sheet_name: string | null;
  }>(
    "SELECT id, cycle_key, cycle_label, status, sheet_id, sheet_name FROM scholarship_cycles WHERE program_id = $1 ORDER BY cycle_label DESC",
    [id]
  );

  return (
    <div>
      <div className="mb-6">
        <Link href="/admin/scholarships" className="text-sm text-zinc-600 hover:underline">
          ← Scholarships
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-900">{program.name}</h1>
            <p className="text-sm text-zinc-500">{program.slug}</p>
          </div>
          <DeleteProgramButton programId={id} programName={program.name} />
        </div>
        {program.description && (
          <p className="mt-1 text-zinc-600">{program.description}</p>
        )}
      </div>

      {user.is_platform_admin && (
        <div className="mb-6">
          <ProgramAdminsSection programId={id} />
        </div>
      )}

      <div className="mb-6">
        <h2 className="mb-3 text-lg font-medium text-zinc-900">Cycles</h2>
        {user.is_platform_admin && <AddCycleForm programId={id} />}
        <div className="mt-4 space-y-2">
          {cycles.length === 0 ? (
            <p className="text-sm text-zinc-500">No cycles yet.</p>
          ) : (
            cycles.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between rounded border border-zinc-200 bg-white px-4 py-3"
              >
                <div>
                  <Link
                    href={`/admin/scholarships/${id}/cycles/${c.id}`}
                    className="font-medium text-zinc-900 hover:underline"
                  >
                    {c.cycle_label}
                  </Link>
                  <span className="ml-2 text-sm text-zinc-500">({c.cycle_key})</span>
                  {c.sheet_name && (
                    <span className="ml-2 text-sm text-zinc-500">
                      Sheet: {c.sheet_name}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded px-2 py-1 text-xs font-medium ${
                      c.status === "active"
                        ? "bg-green-100 text-green-800"
                        : c.status === "draft"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-zinc-100 text-zinc-600"
                    }`}
                  >
                    {c.status}
                  </span>
                  <DeleteCycleButton
                    cycleId={c.id}
                    programId={id}
                    cycleLabel={c.cycle_label}
                    compact
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
