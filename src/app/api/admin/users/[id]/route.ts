import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, hashPassword } from "@/lib/auth";
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

  if (body.resetPassword !== undefined) {
    const newPassword = body.resetPassword;
    if (!newPassword || typeof newPassword !== "string" || newPassword.length < 8) {
      return NextResponse.json(
        { error: "New password must be at least 8 characters" },
        { status: 400 }
      );
    }
    const hash = await hashPassword(newPassword);
    await query(
      "UPDATE users SET password_hash = $1, must_change_password = true, updated_at = now() WHERE id = $2",
      [hash, id]
    );
    await logAudit({
      actorUserId: user.id,
      actionType: "user.password_reset",
      targetType: "user",
      targetId: id,
    });
    return NextResponse.json({ success: true });
  }

  if (body.status !== undefined) {
    const s = body.status;
    if (!["active", "inactive"].includes(s)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    await query("UPDATE users SET status = $1, updated_at = now() WHERE id = $2", [
      s,
      id,
    ]);
    await logAudit({
      actorUserId: user.id,
      actionType: "user.status_changed",
      targetType: "user",
      targetId: id,
      metadata: { status: s },
    });
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "No valid update provided" }, { status: 400 });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!user.is_platform_admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;

  if (id === user.id) {
    return NextResponse.json({ error: "Cannot delete your own account" }, { status: 422 });
  }

  const { rows: target } = await query<{ is_platform_admin: boolean; email: string }>(
    "SELECT is_platform_admin, email FROM users WHERE id = $1",
    [id]
  );
  if (!target[0]) return NextResponse.json({ error: "User not found" }, { status: 404 });

  if (target[0].is_platform_admin) {
    return NextResponse.json(
      { error: "Cannot delete a platform admin account. Remove their admin role first." },
      { status: 422 }
    );
  }

  await query("DELETE FROM users WHERE id = $1", [id]);

  await logAudit({
    actorUserId: user.id,
    actionType: "user.deleted",
    targetType: "user",
    targetId: id,
    metadata: { email: target[0].email },
  });

  return NextResponse.json({ success: true });
}
