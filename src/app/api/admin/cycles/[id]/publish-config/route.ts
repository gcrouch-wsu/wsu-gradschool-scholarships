import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canManageCycle } from "@/lib/admin";
import { logAudit } from "@/lib/audit";
import { query, withTransaction } from "@/lib/db";

/**
 * Publish the latest config for a cycle.
 * Sets published_config_version_id to the most recent config snapshot.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: cycleId } = await params;
  const canManage = await canManageCycle(user.id, user.is_platform_admin, cycleId);
  if (!canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { rows: latestConfig } = await query<{ id: string }>(
    "SELECT id FROM config_versions WHERE cycle_id = $1 ORDER BY version_number DESC LIMIT 1",
    [cycleId]
  );
  const latest = latestConfig[0];
  if (!latest) {
    return NextResponse.json(
      { error: "No config to publish. Save field mapping first." },
      { status: 400 }
    );
  }

  // Collect warnings before publishing (non-blocking).
  const { rows: zeroViewRoles } = await query<{ label: string }>(
    `SELECT r.label
     FROM roles r
     WHERE r.cycle_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM field_permissions fp
         WHERE fp.role_id = r.id AND fp.can_view = true
       )
     ORDER BY r.sort_order`,
    [cycleId]
  );
  const warnings: string[] = zeroViewRoles.map(
    (r) => `Role "${r.label}" has no viewable fields — reviewers assigned this role will see a blank form.`
  );

  await withTransaction(async (tx) => {
    await tx(
      "UPDATE config_versions SET status = 'superseded' WHERE cycle_id = $1 AND id != $2",
      [cycleId, latest.id]
    );
    await tx(
      "UPDATE scholarship_cycles SET published_config_version_id = $1, updated_at = now() WHERE id = $2",
      [latest.id, cycleId]
    );
    await tx(
      "UPDATE config_versions SET status = 'published', published_at = now() WHERE id = $1",
      [latest.id]
    );
  });

  await logAudit({
    actorUserId: user.id,
    cycleId,
    actionType: "cycle.config_published",
    targetType: "config",
    targetId: latest.id,
    metadata: { warnings },
  });

  return NextResponse.json({ success: true, warnings });
}
