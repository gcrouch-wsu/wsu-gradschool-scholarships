import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canManageProgram } from "@/lib/admin";
import { logAudit } from "@/lib/audit";
import { query } from "@/lib/db";

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
