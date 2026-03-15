import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, hashPassword } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { query } from "@/lib/db";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.is_platform_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { rows } = await query<{
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    status: string;
    is_platform_admin: boolean;
    must_change_password: boolean;
    created_at: string;
  }>(
    "SELECT id, email, first_name, last_name, status, is_platform_admin, must_change_password, created_at FROM users ORDER BY last_name, first_name"
  );
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.is_platform_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const {
    email,
    firstName,
    lastName,
    password,
    isPlatformAdmin,
    mustChangePassword,
  } = body;

  if (
    !email ||
    !firstName ||
    !lastName ||
    !password ||
    typeof email !== "string" ||
    typeof firstName !== "string" ||
    typeof lastName !== "string" ||
    typeof password !== "string"
  ) {
    return NextResponse.json(
      { error: "email, firstName, lastName, and password are required" },
      { status: 400 }
    );
  }

  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 }
    );
  }

  const hash = await hashPassword(password);

  try {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO users (email, first_name, last_name, password_hash, must_change_password, is_platform_admin, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')
       RETURNING id`,
      [
        email.trim().toLowerCase(),
        firstName.trim(),
        lastName.trim(),
        hash,
        mustChangePassword !== false,
        isPlatformAdmin === true,
      ]
    );
    const newId = rows[0]!.id;
    await logAudit({
      actorUserId: user.id,
      actionType: "user.created",
      targetType: "user",
      targetId: newId,
      metadata: { email: email.trim().toLowerCase() },
    });
    return NextResponse.json({ id: newId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json(
        { error: "A user with this email already exists" },
        { status: 409 }
      );
    }
    throw err;
  }
}
