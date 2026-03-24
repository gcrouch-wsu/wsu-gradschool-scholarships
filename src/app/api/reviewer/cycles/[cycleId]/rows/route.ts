import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { decrypt } from "@/lib/encryption";
import { getEffectiveReviewerConfig } from "@/lib/reviewer-config";
import { readReviewerVisibilitySettings } from "@/lib/reviewer-field-access";
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

  const effectiveConfig = await getEffectiveReviewerConfig(cycleId);
  const rolePermissions = effectiveConfig.permissions.filter(
    (permission) => permission.role_id === membership[0]!.role_id
  );
  const viewableFieldIds = new Set(
    rolePermissions
      .filter((permission) => permission.can_view)
      .map((permission) => permission.field_config_id)
  );
  const { hiddenFieldKeys } = readReviewerVisibilitySettings(
    effectiveConfig.viewConfig?.settings_json
  );
  const hiddenFieldKeySet = new Set(hiddenFieldKeys);
  const hideIdentity = effectiveConfig.fieldConfigs.some(
    (fieldConfig) =>
      viewableFieldIds.has(fieldConfig.id) &&
      (fieldConfig.purpose === "identity" || fieldConfig.purpose === "subtitle") &&
      hiddenFieldKeySet.has(fieldConfig.field_key)
  );
  const identityFields = effectiveConfig.fieldConfigs
    .filter(
      (fieldConfig) =>
        viewableFieldIds.has(fieldConfig.id) &&
        (fieldConfig.purpose === "identity" || fieldConfig.purpose === "subtitle") &&
        !hiddenFieldKeySet.has(fieldConfig.field_key)
    )
    .map((fieldConfig) => ({
      source_column_id: fieldConfig.source_column_id,
      field_key: fieldConfig.field_key,
    }));

  const result = await getSheetRows(token, cycle.sheet_id);
  if (!result.ok || !result.rows) {
    return NextResponse.json(
      { error: result.error ?? "Failed to fetch rows" },
      { status: 500 }
    );
  }

  const nominees = result.rows.map((row, index) => {
    const identity: Record<string, unknown> = {};
    for (const f of identityFields) {
      identity[f.field_key] = row.cells[f.source_column_id] ?? "";
    }
    const firstIdentityValue = Object.values(identity).find(
      (value) => value != null && String(value).trim() !== ""
    );
    const displayName = hideIdentity
      ? `Applicant ${index + 1}`
      : (identity.name as string) ||
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
