import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canManageCycle } from "@/lib/admin";
import { logAudit } from "@/lib/audit";
import { query, withTransaction } from "@/lib/db";

export const runtime = "nodejs";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; roleId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: cycleId, roleId } = await params;
  if (!await canManageCycle(user.id, user.is_platform_admin, cycleId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { rows: existing } = await query<{ id: string; label: string; sort_order: number }>(
    "SELECT id, label, sort_order FROM roles WHERE id = $1 AND cycle_id = $2",
    [roleId, cycleId]
  );
  const role = existing[0];
  if (!role) return NextResponse.json({ error: "Role not found" }, { status: 404 });

  const body = await request.json() as { label?: string; sort_order?: number };
  const { label, sort_order } = body;

  const setClauses: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (typeof label === "string" && label.trim() && label.trim() !== role.label) {
    setClauses.push(`label = $${idx++}`);
    values.push(label.trim());
  }
  if (typeof sort_order === "number" && sort_order !== role.sort_order) {
    setClauses.push(`sort_order = $${idx++}`);
    values.push(sort_order);
  }

  if (setClauses.length === 0) {
    return NextResponse.json(role);
  }

  values.push(roleId);
  const { rows: updated } = await query<{ id: string; key: string; label: string; sort_order: number }>(
    `UPDATE roles SET ${setClauses.join(", ")} WHERE id = $${idx} RETURNING id, key, label, sort_order`,
    values
  );

  if (typeof label === "string" && label.trim() !== role.label) {
    await logAudit({
      actorUserId: user.id,
      cycleId,
      actionType: "role.updated",
      targetType: "role",
      targetId: roleId,
      metadata: { label: { from: role.label, to: label.trim() } },
    });
  }

  return NextResponse.json(updated[0]);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; roleId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: cycleId, roleId } = await params;
  if (!await canManageCycle(user.id, user.is_platform_admin, cycleId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { rows: roleRows } = await query<{ id: string; label: string; key: string }>(
    "SELECT id, label, key FROM roles WHERE id = $1 AND cycle_id = $2",
    [roleId, cycleId]
  );
  if (!roleRows[0]) return NextResponse.json({ error: "Role not found" }, { status: 404 });

  const { rows: countRows } = await query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM roles WHERE cycle_id = $1",
    [cycleId]
  );
  if (parseInt(countRows[0]?.count ?? "0", 10) <= 1) {
    return NextResponse.json({ error: "Cannot delete the only role on a cycle" }, { status: 422 });
  }

  const { rows: memberRows } = await query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM scholarship_memberships WHERE role_id = $1 AND status = 'active'",
    [roleId]
  );
  if (parseInt(memberRows[0]?.count ?? "0", 10) > 0) {
    return NextResponse.json(
      { error: "Cannot delete a role with active reviewer assignments. Reassign all reviewers to another role first." },
      { status: 422 }
    );
  }

  const { rows: draftRows } = await query<{ id: string }>(
    `SELECT id FROM config_versions
     WHERE cycle_id = $1 AND status = 'draft'
       AND snapshot_json -> 'roles' @> $2::jsonb`,
    [cycleId, JSON.stringify([{ id: roleId }])]
  );
  if (draftRows.length > 0) {
    return NextResponse.json(
      { error: "Cannot delete role: an unpublished config version references this role. Re-save the reviewer builder first." },
      { status: 422 }
    );
  }

  await withTransaction(async (tx) => {
    await tx("DELETE FROM field_permissions WHERE role_id = $1", [roleId]);
    await tx("DELETE FROM roles WHERE id = $1", [roleId]);
  });

  await logAudit({
    actorUserId: user.id,
    cycleId,
    actionType: "role.deleted",
    targetType: "role",
    targetId: roleId,
    metadata: { key: roleRows[0].key, label: roleRows[0].label },
  });

  return NextResponse.json({ success: true });
}
