import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { query } from "@/lib/db";
import { decrypt } from "@/lib/encryption";
import { testConnection } from "@/lib/smartsheet";

export async function POST(
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
  const { rows } = await query<{ encrypted_credentials: string }>(
    "SELECT encrypted_credentials FROM connections WHERE id = $1",
    [id]
  );
  const conn = rows[0];
  if (!conn?.encrypted_credentials) {
    return NextResponse.json({ error: "Connection not found" }, { status: 404 });
  }

  let token: string;
  try {
    token = decrypt(conn.encrypted_credentials);
  } catch {
    return NextResponse.json(
      { error: "Could not decrypt credentials" },
      { status: 500 }
    );
  }

  const result = await testConnection(token);
  if (result.ok) {
    await query(
      "UPDATE connections SET last_verified_at = now(), updated_at = now() WHERE id = $1",
      [id]
    );
    await logAudit({
      actorUserId: user.id,
      actionType: "connection.verified",
      targetType: "connection",
      targetId: id,
    });
  }
  return NextResponse.json(result);
}
