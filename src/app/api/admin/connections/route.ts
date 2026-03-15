import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { query } from "@/lib/db";
import { encrypt } from "@/lib/encryption";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { canAccessAdmin } = await import("@/lib/admin");
  const hasAdminAccess = await canAccessAdmin(user.id, user.is_platform_admin);
  if (!hasAdminAccess) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { rows } = await query<{
    id: string;
    name: string;
    provider: string;
    status: string;
    last_verified_at: string | null;
  }>(
    user.is_platform_admin
      ? "SELECT id, name, provider, status, last_verified_at FROM connections ORDER BY name"
      : `SELECT c.id, c.name, c.provider, c.status, c.last_verified_at
         FROM connections c
         WHERE c.program_id IN (SELECT program_id FROM program_admins WHERE user_id = $1)
         ORDER BY c.name`,
    user.is_platform_admin ? [] : [user.id]
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
  const { name, token, programId } = body;
  if (!name || !token || typeof name !== "string" || typeof token !== "string") {
    return NextResponse.json(
      { error: "name and token are required" },
      { status: 400 }
    );
  }
  const progId = programId && typeof programId === "string" ? programId : null;
  if (progId) {
    const { rows: progRows } = await query<{ id: string }>(
      "SELECT id FROM scholarship_programs WHERE id = $1",
      [progId]
    );
    if (progRows.length === 0) {
      return NextResponse.json({ error: "Program not found" }, { status: 400 });
    }
  }

  let encrypted: string;
  try {
    encrypted = encrypt(token.trim());
  } catch (err) {
    return NextResponse.json(
      { error: "Encryption not configured. Set ENCRYPTION_KEY." },
      { status: 500 }
    );
  }

  const { rows } = await query<{ id: string }>(
    `INSERT INTO connections (name, provider, encrypted_credentials, status, program_id)
     VALUES ($1, 'smartsheet', $2, 'active', $3)
     RETURNING id`,
    [name.trim(), encrypted, progId]
  );
  const newId = rows[0]!.id;
  await logAudit({
    actorUserId: user.id,
    actionType: "connection.created",
    targetType: "connection",
    targetId: newId,
    metadata: { name: name.trim() },
  });
  return NextResponse.json({ id: newId });
}
