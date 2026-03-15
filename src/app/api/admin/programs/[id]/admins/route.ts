import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canManageProgram } from "@/lib/admin";
import { logAudit } from "@/lib/audit";
import { query } from "@/lib/db";

export async function GET(
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

  const { id: programId } = await params;

  const { rows } = await query<{
    user_id: string;
    email: string;
    first_name: string;
    last_name: string;
  }>(
    `SELECT pa.user_id, u.email, u.first_name, u.last_name
     FROM program_admins pa
     JOIN users u ON u.id = pa.user_id
     WHERE pa.program_id = $1
     ORDER BY u.last_name, u.first_name`,
    [programId]
  );
  return NextResponse.json(rows);
}

export async function POST(
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

  const { id: programId } = await params;
  const body = await request.json();
  const { userId } = body;
  if (!userId || typeof userId !== "string") {
    return NextResponse.json(
      { error: "userId is required" },
      { status: 400 }
    );
  }

  try {
    await query(
      `INSERT INTO program_admins (program_id, user_id) VALUES ($1, $2)
       ON CONFLICT (program_id, user_id) DO NOTHING`,
      [programId, userId]
    );
    await logAudit({
      actorUserId: user.id,
      actionType: "program_admin.added",
      targetType: "program",
      targetId: programId,
      metadata: { userId },
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("foreign key")) {
      return NextResponse.json(
        { error: "Invalid program or user" },
        { status: 400 }
      );
    }
    throw err;
  }
}

export async function DELETE(
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

  const { id: programId } = await params;
  const userId = request.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json(
      { error: "userId is required" },
      { status: 400 }
    );
  }

  await query(
    "DELETE FROM program_admins WHERE program_id = $1 AND user_id = $2",
    [programId, userId]
  );
  await logAudit({
    actorUserId: user.id,
    actionType: "program_admin.removed",
    targetType: "program",
    targetId: programId,
    metadata: { userId },
  });
  return NextResponse.json({ success: true });
}
