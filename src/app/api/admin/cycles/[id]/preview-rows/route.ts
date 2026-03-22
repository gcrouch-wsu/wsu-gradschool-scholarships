import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canManageCycle } from "@/lib/admin";
import { query } from "@/lib/db";
import { decrypt } from "@/lib/encryption";
import { getEffectiveReviewerConfig } from "@/lib/reviewer-config";
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

  const effectiveConfig = await getEffectiveReviewerConfig(cycleId);
  const rolePermissions = effectiveConfig.permissions.filter(
    (permission) => permission.role_id === roleId
  );
  const viewableFieldIds = new Set(
    rolePermissions
      .filter((permission) => permission.can_view)
      .map((permission) => permission.field_config_id)
  );
  const viewSettings = effectiveConfig.viewConfig?.settings_json as {
    blindReview?: boolean;
    hiddenFieldKeys?: string[];
  } | null;
  const blindReview = viewSettings?.blindReview ?? false;
  const hiddenFieldKeys = new Set(viewSettings?.hiddenFieldKeys ?? []);
  const identityFields = effectiveConfig.fieldConfigs
    .filter(
      (fieldConfig) =>
        viewableFieldIds.has(fieldConfig.id) &&
        (fieldConfig.purpose === "identity" || fieldConfig.purpose === "subtitle") &&
        (!blindReview || !hiddenFieldKeys.has(fieldConfig.field_key))
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

  const colIds = identityFields.map((f) => f.source_column_id);
  const nominees = result.rows.map((row, index) => {
    const identity: Record<string, unknown> = {};
    for (const f of identityFields) {
      identity[f.field_key] = row.cells[f.source_column_id] ?? "";
    }
    const firstIdentityValue = Object.values(identity).find((v) => v != null && String(v).trim() !== "");
    const displayName = blindReview
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
