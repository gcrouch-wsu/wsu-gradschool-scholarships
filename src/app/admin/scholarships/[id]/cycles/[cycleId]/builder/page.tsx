import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { canManageCycle } from "@/lib/admin";
import { query } from "@/lib/db";
import { FieldMappingBuilder } from "./FieldMappingBuilder";

export default async function BuilderPage({
  params,
}: {
  params: Promise<{ id: string; cycleId: string }>;
}) {
  const { id: programId, cycleId } = await params;
  const user = await getSessionUser();
  if (!user) notFound();
  const canManage = await canManageCycle(user.id, user.is_platform_admin, cycleId);
  if (!canManage) {
    return (
      <div className="text-zinc-600">
        You do not have permission to configure the builder.
      </div>
    );
  }

  const { rows: cycles } = await query<{
    id: string;
    cycle_key: string;
    cycle_label: string;
    sheet_schema_snapshot_json: unknown;
  }>(
    "SELECT id, cycle_key, cycle_label, sheet_schema_snapshot_json FROM scholarship_cycles WHERE id = $1 AND program_id = $2",
    [cycleId, programId]
  );
  const cycle = cycles[0];
  if (!cycle) notFound();

  const { rows: program } = await query<{ name: string }>(
    "SELECT name FROM scholarship_programs WHERE id = $1",
    [programId]
  );

  const schema = cycle.sheet_schema_snapshot_json as {
    columns?: Array<{ id: number; index: number; title: string; type: string }>;
  } | null;
  const hasSchema = !!schema?.columns?.length;

  return (
    <div>
      <Link
        href={`/admin/scholarships/${programId}/cycles/${cycleId}`}
        className="text-sm text-zinc-600 hover:underline"
      >
        ← {program[0]?.name ?? "Program"} – {cycle.cycle_label}
      </Link>
      <h1 className="mt-4 text-2xl font-semibold text-zinc-900">
        Field mapping & layout
      </h1>
      <p className="mt-1 text-sm text-zinc-600">
        Map Smartsheet columns to identity, narrative, score, and comments. Set
        display labels, role visibility, and layout.
      </p>

      {!hasSchema ? (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-amber-900">
            Import the sheet schema first from the cycle configuration page.
          </p>
          <Link
            href={`/admin/scholarships/${programId}/cycles/${cycleId}`}
            className="mt-2 inline-block text-sm font-medium text-amber-800 hover:underline"
          >
            Go to cycle config →
          </Link>
        </div>
      ) : (
        <FieldMappingBuilder
          programId={programId}
          cycleId={cycleId}
        />
      )}
    </div>
  );
}
