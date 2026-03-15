import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canManageCycle } from "@/lib/admin";
import { query } from "@/lib/db";
import { decrypt } from "@/lib/encryption";
import { getSheetRows } from "@/lib/smartsheet";

export async function GET(
  _request: Request,
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

  const { rows: roles } = await query<{ id: string }>(
    "SELECT id FROM roles WHERE cycle_id = $1 ORDER BY sort_order LIMIT 1",
    [cycleId]
  );
  const roleId = roles[0]?.id;
  if (!roleId) {
    return NextResponse.json(
      { error: "No roles configured" },
      { status: 400 }
    );
  }

  const { rows: cycles } = await query<{
    connection_id: string;
    sheet_id: number;
  }>(
    "SELECT connection_id, sheet_id FROM scholarship_cycles WHERE id = $1",
    [cycleId]
  );
  const cycle = cycles[0];
  if (!cycle?.connection_id || !cycle.sheet_id) {
    return NextResponse.json(
      { error: "Cycle has no sheet configured" },
      { status: 400 }
    );
  }

  const { rows: conn } = await query<{ encrypted_credentials: string }>(
    "SELECT encrypted_credentials FROM connections WHERE id = $1",
    [cycle.connection_id]
  );
  if (!conn[0]?.encrypted_credentials) {
    return NextResponse.json({ error: "Connection not found" }, { status: 500 });
  }

  let token: string;
  try {
    token = decrypt(conn[0].encrypted_credentials);
  } catch {
    return NextResponse.json(
      { error: "Could not decrypt credentials" },
      { status: 500 }
    );
  }

  const { rows: identityFields } = await query<{
    source_column_id: number;
    field_key: string;
  }>(
    `SELECT source_column_id, field_key FROM field_configs fc
     JOIN field_permissions fp ON fp.field_config_id = fc.id
     WHERE fc.cycle_id = $1 AND fp.role_id = $2 AND fp.can_view = true
     AND fc.purpose IN ('identity', 'subtitle')`,
    [cycleId, roleId]
  );

  const result = await getSheetRows(token, cycle.sheet_id);
  if (!result.ok || !result.rows) {
    return NextResponse.json(
      { error: result.error ?? "Failed to fetch rows" },
      { status: 500 }
    );
  }

  const colIds = identityFields.map((f) => f.source_column_id);
  const nominees = result.rows.map((row) => {
    const identity: Record<string, unknown> = {};
    for (const f of identityFields) {
      identity[f.field_key] = row.cells[f.source_column_id] ?? "";
    }
    const firstIdentityValue = Object.values(identity).find(
      (v) => v != null && String(v).trim() !== ""
    );
    const displayName =
      (identity.name as string) ||
      (identity.title as string) ||
      (identity["Applicant Name"] as string) ||
      (firstIdentityValue != null ? String(firstIdentityValue) : null) ||
      `Row ${row.id}`;
    return {
      id: row.id,
      displayName: String(displayName),
      identity,
    };
  });

  return NextResponse.json({ rows: nominees });
}
