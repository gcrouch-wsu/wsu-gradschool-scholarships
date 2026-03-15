import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canManageCycle } from "@/lib/admin";
import { query } from "@/lib/db";
import { decrypt } from "@/lib/encryption";
import { getSheetSchema } from "@/lib/smartsheet";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: connectionId } = await params;
  const body = await request.json();
  const sheetId = body?.sheetId;
  const cycleId = body?.cycleId;

  // Platform admins can use any connection. Scholarship admins need cycleId, must manage that cycle, and connection must be assigned to the cycle's program.
  if (!user.is_platform_admin) {
    if (!cycleId || typeof cycleId !== "string") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const canManage = await canManageCycle(user.id, user.is_platform_admin, cycleId);
    if (!canManage) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { rows: cycleRows } = await query<{ program_id: string }>(
      "SELECT program_id FROM scholarship_cycles WHERE id = $1",
      [cycleId]
    );
    const programId = cycleRows[0]?.program_id;
    if (programId) {
      const { rows: connRows } = await query<{ id: string }>(
        "SELECT id FROM connections WHERE id = $1 AND program_id = $2",
        [connectionId, programId]
      );
      if (connRows.length === 0) {
        return NextResponse.json(
          { error: "Connection is not assigned to this program" },
          { status: 403 }
        );
      }
    }
  }

  const id = connectionId;
  if (!sheetId || typeof sheetId !== "number") {
    return NextResponse.json(
      { error: "sheetId (number) is required" },
      { status: 400 }
    );
  }

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

  const result = await getSheetSchema(token, sheetId);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error ?? "Failed to fetch schema" },
      { status: 400 }
    );
  }

  return NextResponse.json({
    sheet: result.sheet,
    columns: result.sheet?.columns ?? [],
  });
}
