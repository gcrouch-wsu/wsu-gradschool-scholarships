import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canManageProgram } from "@/lib/admin";
import { logAudit } from "@/lib/audit";
import { query } from "@/lib/db";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const programId = request.nextUrl.searchParams.get("programId");
  if (!programId) {
    return NextResponse.json(
      { error: "programId is required" },
      { status: 400 }
    );
  }

  const canManage = await canManageProgram(user.id, user.is_platform_admin, programId);
  if (!canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { rows } = await query<{
    id: string;
    cycle_key: string;
    cycle_label: string;
    status: string;
    sheet_id: number | null;
    sheet_name: string | null;
    created_at: string;
  }>(
    `SELECT id, cycle_key, cycle_label, status, sheet_id, sheet_name, created_at
     FROM scholarship_cycles
     WHERE program_id = $1
     ORDER BY cycle_label DESC`,
    [programId]
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
  const { programId, cycleKey, cycleLabel } = body;
  if (
    !programId ||
    !cycleKey ||
    !cycleLabel ||
    typeof programId !== "string" ||
    typeof cycleKey !== "string" ||
    typeof cycleLabel !== "string"
  ) {
    return NextResponse.json(
      { error: "programId, cycleKey, and cycleLabel are required" },
      { status: 400 }
    );
  }

  const safeKey = cycleKey.trim();
  if (!safeKey) {
    return NextResponse.json(
      { error: "cycleKey cannot be empty" },
      { status: 400 }
    );
  }

  try {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO scholarship_cycles (program_id, cycle_key, cycle_label, status)
       VALUES ($1, $2, $3, 'draft')
       RETURNING id`,
      [programId, safeKey, cycleLabel.trim()]
    );
    const cycleId = rows[0]!.id;
    // Create default Reviewer role so assignments can be made (handoff: cycle-owned roles)
    await query(
      `INSERT INTO roles (cycle_id, key, label, sort_order) VALUES ($1, 'reviewer', 'Reviewer', 0)`,
      [cycleId]
    );
    await logAudit({
      actorUserId: user.id,
      cycleId,
      actionType: "cycle.created",
      targetType: "cycle",
      targetId: cycleId,
      metadata: { programId, cycleKey: safeKey, cycleLabel: cycleLabel.trim() },
    });
    return NextResponse.json({ id: cycleId, cycleKey: safeKey });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json(
        { error: "A cycle with this key already exists for this program" },
        { status: 409 }
      );
    }
    throw err;
  }
}
