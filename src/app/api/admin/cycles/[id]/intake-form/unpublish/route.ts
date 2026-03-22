import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canManageCycle } from "@/lib/admin";
import { logAudit } from "@/lib/audit";
import { query } from "@/lib/db";

export const runtime = "nodejs";

/**
 * POST: Unpublish the intake form.
 */

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: cycleId } = await params;
  if (!await canManageCycle(user.id, user.is_platform_admin, cycleId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { rows: updated } = await query<{ id: string }>(
    "UPDATE intake_forms SET status = 'unpublished', updated_at = now() WHERE cycle_id = $1 RETURNING id",
    [cycleId]
  );

  if (updated.length === 0) {
    return NextResponse.json({ error: "Intake form not found" }, { status: 404 });
  }

  await logAudit({
    actorUserId: user.id,
    cycleId,
    actionType: "intake.form_unpublished",
    targetType: "intake_form",
    targetId: updated[0].id,
  });

  return NextResponse.json({ success: true });
}
