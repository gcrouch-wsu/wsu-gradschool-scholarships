import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canManageCycle } from "@/lib/admin";
import { logAudit } from "@/lib/audit";
import { query, withTransaction } from "@/lib/db";

/**
 * Publish the latest config version for a cycle.
 * Sets published_config_version_id to the most recent config_version.
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

  const { rows: versions } = await query<{ id: string; version_number: number }>(
    "SELECT id, version_number FROM config_versions WHERE cycle_id = $1 ORDER BY version_number DESC LIMIT 1",
    [cycleId]
  );
  const latest = versions[0];
  if (!latest) {
    return NextResponse.json(
      { error: "No config versions to publish. Save field mapping first." },
      { status: 400 }
    );
  }

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
    targetType: "config_version",
    targetId: latest.id,
    metadata: { versionNumber: latest.version_number },
  });

  return NextResponse.json({
    success: true,
    configVersionId: latest.id,
    versionNumber: latest.version_number,
  });
}
