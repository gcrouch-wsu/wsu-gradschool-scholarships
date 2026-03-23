import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canManageProgram } from "@/lib/admin";
import { logAudit } from "@/lib/audit";
import { query } from "@/lib/db";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: programId } = await params;
  if (!await canManageProgram(user.id, user.is_platform_admin, programId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json() as { name?: string; description?: string | null };
  const { name, description } = body;

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name is required and cannot be empty" }, { status: 422 });
  }

  const { rows: existing } = await query<{ id: string; name: string; description: string | null }>(
    "SELECT id, name, description FROM scholarship_programs WHERE id = $1",
    [programId]
  );
  const program = existing[0];
  if (!program) return NextResponse.json({ error: "Program not found" }, { status: 404 });

  const newName = name.trim();
  // null means "clear the description"; string means "set to trimmed value or null if blank"; undefined means "not provided"
  const newDescription = description === null ? null
    : typeof description === "string" ? (description.trim() || null)
    : undefined;
  const nameChanged = newName !== program.name;
  const descChanged = newDescription !== undefined && newDescription !== program.description;

  if (!nameChanged && !descChanged) {
    return NextResponse.json({ id: programId, name: program.name, description: program.description });
  }

  const setClauses: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  if (nameChanged) { setClauses.push(`name = $${idx++}`); values.push(newName); }
  if (descChanged) { setClauses.push(`description = $${idx++}`); values.push(newDescription); }
  setClauses.push("updated_at = now()");
  values.push(programId);

  const { rows: updated } = await query<{ id: string; name: string; description: string | null }>(
    `UPDATE scholarship_programs SET ${setClauses.join(", ")} WHERE id = $${idx} RETURNING id, name, description`,
    values
  );

  const metadata: Record<string, unknown> = {};
  if (nameChanged) metadata.name = { from: program.name, to: newName };
  if (descChanged) metadata.description = { from: program.description, to: newDescription };

  await logAudit({
    actorUserId: user.id,
    actionType: "program.updated",
    targetType: "program",
    targetId: programId,
    metadata,
  });

  return NextResponse.json(updated[0]);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: programId } = await params;
  const canManage = await canManageProgram(user.id, user.is_platform_admin, programId);
  if (!canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { rows: existingPrograms } = await query<{ id: string; name: string }>(
    "SELECT id, name FROM scholarship_programs WHERE id = $1",
    [programId]
  );
  const program = existingPrograms[0];
  if (!program) {
    return NextResponse.json({ error: "Scholarship not found" }, { status: 404 });
  }

  await query("DELETE FROM scholarship_programs WHERE id = $1", [programId]);

  await logAudit({
    actorUserId: user.id,
    actionType: "program.deleted",
    targetType: "program",
    targetId: programId,
    metadata: { name: program.name },
  });

  return NextResponse.json({ success: true });
}
