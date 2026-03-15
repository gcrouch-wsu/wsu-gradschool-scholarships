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
