import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { query } from "@/lib/db";
import { encrypt } from "@/lib/encryption";
import { testConnection } from "@/lib/smartsheet";

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

  const { id } = await params;
  const body = await request.json();
  const { token: newToken } = body;
  if (!newToken || typeof newToken !== "string") {
    return NextResponse.json(
      { error: "token (new Smartsheet API token) is required" },
      { status: 400 }
    );
  }

  const trimmed = newToken.trim();
  const result = await testConnection(trimmed);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error ?? "New token failed verification" },
      { status: 400 }
    );
  }

  let encrypted: string;
  try {
    encrypted = encrypt(trimmed);
  } catch (err) {
    return NextResponse.json(
      { error: "Encryption not configured. Set ENCRYPTION_KEY." },
      { status: 500 }
    );
  }

  await query(
    "UPDATE connections SET encrypted_credentials = $1, rotated_at = now(), last_verified_at = now(), updated_at = now() WHERE id = $2",
    [encrypted, id]
  );

  await logAudit({
    actorUserId: user.id,
    actionType: "connection.rotated",
    targetType: "connection",
    targetId: id,
  });

  return NextResponse.json({ success: true });
}
