import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canManageCycle } from "@/lib/admin";
import { logAudit } from "@/lib/audit";
import { query } from "@/lib/db";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const canManage = await canManageCycle(user.id, user.is_platform_admin, id);
  if (!canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();

  if (body.connectionId !== undefined && !user.is_platform_admin) {
    const { rows: cycleRows } = await query<{ program_id: string }>(
      "SELECT program_id FROM scholarship_cycles WHERE id = $1",
      [id]
    );
    const programId = cycleRows[0]?.program_id;
    if (programId && body.connectionId) {
      const { rows: connRows } = await query<{ id: string }>(
        "SELECT id FROM connections WHERE id = $1 AND program_id = $2",
        [body.connectionId, programId]
      );
      if (connRows.length === 0) {
        return NextResponse.json(
          { error: "Connection is not assigned to this program" },
          { status: 403 }
        );
      }
    }
  }

  const updates: string[] = [];
  const values: unknown[] = [];
  let i = 1;

  if (body.connectionId !== undefined) {
    updates.push(`connection_id = $${i++}`);
    values.push(body.connectionId || null);
  }
  if (body.sheetId !== undefined) {
    updates.push(`sheet_id = $${i++}`);
    values.push(body.sheetId ?? null);
  }
  if (body.sheetName !== undefined) {
    updates.push(`sheet_name = $${i++}`);
    values.push(body.sheetName ?? null);
  }
  if (body.sheetSchemaSnapshot !== undefined) {
    updates.push(`sheet_schema_snapshot_json = $${i++}`);
    values.push(JSON.stringify(body.sheetSchemaSnapshot));
  }
  if (body.schemaSyncedAt !== undefined) {
    updates.push(`schema_synced_at = $${i++}`);
    values.push(body.schemaSyncedAt);
  }
  if (body.schemaStatus !== undefined) {
    updates.push(`schema_status = $${i++}`);
    values.push(body.schemaStatus);
  }
  if (body.status !== undefined) {
    const s = body.status;
    if (!["draft", "active", "closed", "archived"].includes(s)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    updates.push(`status = $${i++}`);
    values.push(s);
  }
  if (body.allowExternalReviewers !== undefined) {
    updates.push(`allow_external_reviewers = $${i++}`);
    values.push(!!body.allowExternalReviewers);
  }
  if (body.publishedConfigVersionId !== undefined) {
    updates.push(`published_config_version_id = $${i++}`);
    values.push(body.publishedConfigVersionId || null);
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "No updates provided" }, { status: 400 });
  }

  updates.push(`updated_at = now()`);
  values.push(id);

  await query(
    `UPDATE scholarship_cycles SET ${updates.join(", ")} WHERE id = $${i}`,
    values
  );
  await logAudit({
    actorUserId: user.id,
    cycleId: id,
    actionType: "cycle.updated",
    targetType: "cycle",
    targetId: id,
    metadata: Object.fromEntries(
      Object.entries(body).filter(([k]) =>
        ["connectionId", "sheetId", "status", "allowExternalReviewers", "schemaSyncedAt", "publishedConfigVersionId"].includes(k)
      )
    ),
  });
  return NextResponse.json({ success: true });
}
