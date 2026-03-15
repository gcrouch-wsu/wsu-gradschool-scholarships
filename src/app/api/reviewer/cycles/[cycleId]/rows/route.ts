import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { decrypt } from "@/lib/encryption";
import { getSheetRows } from "@/lib/smartsheet";

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

  const { rows: cycles } = await query<{
    connection_id: string;
    sheet_id: number;
    sheet_schema_snapshot_json: unknown;
  }>(
    "SELECT connection_id, sheet_id, sheet_schema_snapshot_json FROM scholarship_cycles WHERE id = $1",
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
    return NextResponse.json(
      { error: "Connection not found" },
      { status: 500 }
    );
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
    [cycleId, membership[0]!.role_id]
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
    const displayName =
      (identity.name as string) ||
      (identity.title as string) ||
      (identity["Applicant Name"] as string) ||
      `Row ${row.id}`;
    return {
      id: row.id,
      displayName: String(displayName),
      identity,
    };
  });

  return NextResponse.json({ rows: nominees });
}
