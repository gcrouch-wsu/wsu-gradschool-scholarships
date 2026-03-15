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
  if (body.cycleKey !== undefined) {
    const key = String(body.cycleKey).trim();
    if (!key) {
      return NextResponse.json({ error: "cycleKey cannot be empty" }, { status: 400 });
    }
    updates.push(`cycle_key = $${i++}`);
    values.push(key);
  }
  if (body.cycleLabel !== undefined) {
    const label = String(body.cycleLabel).trim();
    if (!label) {
      return NextResponse.json({ error: "cycleLabel cannot be empty" }, { status: 400 });
    }
    updates.push(`cycle_label = $${i++}`);
    values.push(label);
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "No updates provided" }, { status: 400 });
  }

  updates.push(`updated_at = now()`);
  values.push(id);

  try {
    await query(
      `UPDATE scholarship_cycles SET ${updates.join(", ")} WHERE id = $${i}`,
      values
    );
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
  await logAudit({
    actorUserId: user.id,
    cycleId: id,
    actionType: "cycle.updated",
    targetType: "cycle",
    targetId: id,
    metadata: Object.fromEntries(
      Object.entries(body).filter(([k]) =>
        ["connectionId", "sheetId", "status", "allowExternalReviewers", "schemaSyncedAt", "publishedConfigVersionId", "cycleKey", "cycleLabel"].includes(k)
      )
    ),
  });
  return NextResponse.json({ success: true });
}

export async function DELETE(
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

  const { rows: cycle } = await query<{ program_id: string }>(
    "SELECT program_id FROM scholarship_cycles WHERE id = $1",
    [cycleId]
  );
  if (cycle.length === 0) {
    return NextResponse.json({ error: "Cycle not found" }, { status: 404 });
  }

  await query("DELETE FROM scholarship_cycles WHERE id = $1", [cycleId]);

  await logAudit({
    actorUserId: user.id,
    cycleId,
    actionType: "cycle.deleted",
    targetType: "cycle",
    targetId: cycleId,
    metadata: { programId: cycle[0]?.program_id },
  });

  return NextResponse.json({ success: true });
}
