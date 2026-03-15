import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { query } from "@/lib/db";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.is_platform_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const { programId } = body;

  if (programId !== undefined) {
    const { rows: connRows } = await query<{ id: string }>(
      "SELECT id FROM connections WHERE id = $1",
      [id]
    );
    if (connRows.length === 0) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    if (programId !== null && typeof programId !== "string") {
      return NextResponse.json({ error: "programId must be a UUID or null" }, { status: 400 });
    }
    if (programId) {
      const { rows: progRows } = await query<{ id: string }>(
        "SELECT id FROM scholarship_programs WHERE id = $1",
        [programId]
      );
      if (progRows.length === 0) {
        return NextResponse.json({ error: "Program not found" }, { status: 400 });
      }
    }
    await query(
      "UPDATE connections SET program_id = $1, updated_at = now() WHERE id = $2",
      [programId || null, id]
    );
    await logAudit({
      actorUserId: user.id,
      actionType: "connection.program_assigned",
      targetType: "connection",
      targetId: id,
      metadata: { programId: programId || null },
    });
  }

  return NextResponse.json({ success: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.is_platform_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const { rows: connRows } = await query<{ id: string; name: string }>(
    "SELECT id, name FROM connections WHERE id = $1",
    [id]
  );
  if (connRows.length === 0) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  await query("DELETE FROM connections WHERE id = $1", [id]);
  await logAudit({
    actorUserId: user.id,
    actionType: "connection.deleted",
    targetType: "connection",
    targetId: id,
    metadata: { name: connRows[0].name },
  });

  return NextResponse.json({ success: true });
}
