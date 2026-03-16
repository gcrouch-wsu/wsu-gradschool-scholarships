import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canManageCycle } from "@/lib/admin";
import { logAudit } from "@/lib/audit";
import { query } from "@/lib/db";

/**
 * Unpublish the current config for a cycle.
 * Sets published_config_version_id to null. Reviewers will see no config until republished.
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

  const { rows: cycle } = await query<{ published_config_version_id: string | null }>(
    "SELECT published_config_version_id FROM scholarship_cycles WHERE id = $1",
    [cycleId]
  );
  const publishedId = cycle[0]?.published_config_version_id;
  if (!publishedId) {
    return NextResponse.json(
      { error: "No published config to unpublish" },
      { status: 400 }
    );
  }

  await query(
    "UPDATE scholarship_cycles SET published_config_version_id = NULL, updated_at = now() WHERE id = $1",
    [cycleId]
  );
  await query(
    "UPDATE config_versions SET status = 'superseded', published_at = NULL WHERE id = $1",
    [publishedId]
  );

  await logAudit({
    actorUserId: user.id,
    cycleId,
    actionType: "cycle.config_unpublished",
    targetType: "config",
    targetId: publishedId,
    metadata: {},
  });

  return NextResponse.json({ success: true });
}
