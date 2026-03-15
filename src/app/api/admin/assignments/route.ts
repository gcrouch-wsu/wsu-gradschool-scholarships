import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canManageCycle } from "@/lib/admin";
import { logAudit } from "@/lib/audit";
import { query } from "@/lib/db";

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { cycleId, userId, roleId } = body;
  if (!cycleId) {
    return NextResponse.json({ error: "cycleId is required" }, { status: 400 });
  }
  const canManage = await canManageCycle(user.id, user.is_platform_admin, cycleId);
  if (!canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (
    !cycleId ||
    !userId ||
    !roleId ||
    typeof cycleId !== "string" ||
    typeof userId !== "string" ||
    typeof roleId !== "string"
  ) {
    return NextResponse.json(
      { error: "cycleId, userId, and roleId are required" },
      { status: 400 }
    );
  }

  const { rows: roleCheck } = await query<{ id: string }>(
    "SELECT id FROM roles WHERE id = $1 AND cycle_id = $2",
    [roleId, cycleId]
  );
  if (roleCheck.length === 0) {
    return NextResponse.json(
      { error: "Invalid role for this cycle" },
      { status: 400 }
    );
  }

  const { rows: cycleRows } = await query<{ allow_external_reviewers: boolean }>(
    "SELECT allow_external_reviewers FROM scholarship_cycles WHERE id = $1",
    [cycleId]
  );
  const allowExternal = cycleRows[0]?.allow_external_reviewers ?? false;
  if (!allowExternal) {
    const allowedDomain =
      (process.env.ALLOWED_REVIEWER_EMAIL_DOMAIN || "wsu.edu").toLowerCase();
    const { rows: userRows } = await query<{ email: string }>(
      "SELECT email FROM users WHERE id = $1 AND status = 'active'",
      [userId]
    );
    if (userRows.length === 0) {
      return NextResponse.json(
        { error: "User not found or inactive" },
        { status: 400 }
      );
    }
    const email = (userRows[0].email || "").toLowerCase();
    const domain = email.split("@")[1] || "";
    if (domain !== allowedDomain) {
      return NextResponse.json(
        {
          error: `This cycle allows only reviewers with @${allowedDomain} email addresses. Enable external reviewers to assign others.`,
        },
        { status: 400 }
      );
    }
  }

  try {
    await query(
      `INSERT INTO scholarship_memberships (cycle_id, user_id, role_id, status)
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT (cycle_id, user_id) DO UPDATE SET role_id = $3, status = 'active'`,
      [cycleId, userId, roleId]
    );
    await logAudit({
      actorUserId: user.id,
      cycleId,
      actionType: "assignment.created",
      targetType: "membership",
      metadata: { userId, roleId },
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("foreign key") || msg.includes("violates")) {
      return NextResponse.json(
        { error: "Invalid cycle, user, or role" },
        { status: 400 }
      );
    }
    throw err;
  }
}

export async function DELETE(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cycleId = request.nextUrl.searchParams.get("cycleId");
  const userId = request.nextUrl.searchParams.get("userId");
  if (!cycleId) {
    return NextResponse.json({ error: "cycleId is required" }, { status: 400 });
  }
  const canManage = await canManageCycle(user.id, user.is_platform_admin, cycleId);
  if (!canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!cycleId || !userId) {
    return NextResponse.json(
      { error: "cycleId and userId are required" },
      { status: 400 }
    );
  }

  await query(
    "DELETE FROM scholarship_memberships WHERE cycle_id = $1 AND user_id = $2",
    [cycleId, userId]
  );
  await logAudit({
    actorUserId: user.id,
    cycleId,
    actionType: "assignment.removed",
    targetType: "membership",
    metadata: { userId },
  });
  return NextResponse.json({ success: true });
}
