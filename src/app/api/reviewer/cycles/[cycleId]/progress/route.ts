import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { query } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ cycleId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { cycleId } = await params;

  const { rows: membership } = await query<{ role_id: string }>(
    `SELECT role_id FROM scholarship_memberships m
     JOIN scholarship_cycles c ON c.id = m.cycle_id
     WHERE m.user_id = $1 AND m.cycle_id = $2 AND m.status = 'active' AND c.status = 'active'`,
    [user.id, cycleId]
  );
  if (membership.length === 0) {
    return NextResponse.json({ error: "Not assigned to this cycle" }, { status: 403 });
  }

  const { rows } = await query<{ last_row_id: number | null }>(
    "SELECT last_row_id FROM user_cycle_progress WHERE user_id = $1 AND cycle_id = $2",
    [user.id, cycleId]
  );
  return NextResponse.json({
    lastRowId: rows[0]?.last_row_id ?? null,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ cycleId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { cycleId } = await params;

  const { rows: membership } = await query<{ role_id: string }>(
    `SELECT role_id FROM scholarship_memberships m
     JOIN scholarship_cycles c ON c.id = m.cycle_id
     WHERE m.user_id = $1 AND m.cycle_id = $2 AND m.status = 'active' AND c.status = 'active'`,
    [user.id, cycleId]
  );
  if (membership.length === 0) {
    return NextResponse.json({ error: "Not assigned to this cycle" }, { status: 403 });
  }

  const body = await request.json();
  const lastRowId = body?.lastRowId;
  if (lastRowId == null || typeof lastRowId !== "number") {
    return NextResponse.json(
      { error: "lastRowId (number) is required" },
      { status: 400 }
    );
  }

  await query(
    `INSERT INTO user_cycle_progress (user_id, cycle_id, last_row_id, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id, cycle_id) DO UPDATE SET last_row_id = $3, updated_at = now()`,
    [user.id, cycleId, lastRowId]
  );

  return NextResponse.json({ success: true });
}
