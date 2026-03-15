import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, hashPassword } from "@/lib/auth";
import { canAccessAdmin } from "@/lib/admin";
import { query } from "@/lib/db";

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { newPassword } = body;
  if (!newPassword || typeof newPassword !== "string" || newPassword.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 }
    );
  }

  const hash = await hashPassword(newPassword);
  await query(
    "UPDATE users SET password_hash = $1, must_change_password = false, updated_at = now() WHERE id = $2",
    [hash, user.id]
  );

  const hasAdminAccess = await canAccessAdmin(user.id, user.is_platform_admin);
  return NextResponse.json({
    success: true,
    redirectTo: hasAdminAccess ? "admin" : "reviewer",
  });
}
