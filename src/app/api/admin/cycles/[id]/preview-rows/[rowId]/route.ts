import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canManageCycle } from "@/lib/admin";
import { getLiveColumnIds } from "@/lib/reviewer";
import { query } from "@/lib/db";
import { decrypt } from "@/lib/encryption";
import { getEffectiveReviewerConfig } from "@/lib/reviewer-config";
import { getSheetRows } from "@/lib/smartsheet";

async function getPreviewRowData(cycleId: string, rowId: number) {
  const { rows: roles } = await query<{ id: string }>(
    "SELECT id FROM roles WHERE cycle_id = $1 ORDER BY sort_order LIMIT 1",
    [cycleId]
  );
  const roleId = roles[0]?.id;
  if (!roleId) return null;

  const { rows: cycles } = await query<{
    connection_id: string;
    sheet_id: number;
  }>(
    "SELECT connection_id, sheet_id FROM scholarship_cycles WHERE id = $1",
    [cycleId]
  );
  const cycle = cycles[0];
  if (!cycle?.connection_id || !cycle.sheet_id) return null;

  const { rows: conn } = await query<{ encrypted_credentials: string }>(
    "SELECT encrypted_credentials FROM connections WHERE id = $1",
    [cycle.connection_id]
  );
  if (!conn[0]?.encrypted_credentials) return null;

  let token: string;
  try {
    token = decrypt(conn[0].encrypted_credentials);
  } catch {
    return null;
  }

  const result = await getSheetRows(token, cycle.sheet_id);
  if (!result.ok || !result.rows) return null;

  const row = result.rows.find((r) => r.id === rowId);
  return row ? { row, roleId } : null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; rowId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: cycleId, rowId } = await params;
  const rowIdNum = parseInt(rowId, 10);
  if (isNaN(rowIdNum)) {
    return NextResponse.json({ error: "Invalid row ID" }, { status: 400 });
  }

  const canManage = await canManageCycle(user.id, user.is_platform_admin, cycleId);
  if (!canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const data = await getPreviewRowData(cycleId, rowIdNum);
  if (!data) {
    return NextResponse.json(
      { error: "Row not found or cycle not configured" },
      { status: 404 }
    );
  }

  const liveColumnIds = await getLiveColumnIds(cycleId);
  if (!liveColumnIds) {
    return NextResponse.json(
      { error: "Could not verify sheet schema. Check connection and sheet." },
      { status: 400 }
    );
  }

  const effectiveConfig = await getEffectiveReviewerConfig(cycleId);
  const rolePermissions = effectiveConfig.permissions.filter(
    (permission) => permission.role_id === data.roleId
  );
  const viewablePermissionByFieldId = new Map(
    rolePermissions
      .filter((permission) => permission.can_view)
      .map((permission) => [permission.field_config_id, permission])
  );
  const fieldConfigs = effectiveConfig.fieldConfigs
    .filter((fieldConfig) => viewablePermissionByFieldId.has(fieldConfig.id))
    .map((fieldConfig) => ({
      ...fieldConfig,
      can_edit: viewablePermissionByFieldId.get(fieldConfig.id)?.can_edit ?? false,
    }));

  const sectionFields = effectiveConfig.sectionFields;
  const viewSections = effectiveConfig.viewSections;
  const fieldIdToSectionKey = Object.fromEntries(
    sectionFields.map((sf) => {
      const vs = viewSections.find((s) => s.id === sf.view_section_id);
      return [sf.field_config_id, vs?.section_key ?? "main"];
    })
  );
  const viewSettings = effectiveConfig.viewConfig?.settings_json as {
    blindReview?: boolean;
    hiddenFieldKeys?: string[];
  } | null;
  const blindReview = viewSettings?.blindReview ?? false;
  const hiddenFieldKeys = new Set(viewSettings?.hiddenFieldKeys ?? []);

  const validConfigs = fieldConfigs
    .filter((fieldConfig) => liveColumnIds.has(String(fieldConfig.source_column_id)))
    .filter((fieldConfig) => !blindReview || !hiddenFieldKeys.has(fieldConfig.field_key));
  const fields = validConfigs.map((f) => ({
    fieldKey: f.field_key,
    sourceColumnId: f.source_column_id,
    purpose: f.purpose,
    displayLabel: f.display_label,
    displayType: f.display_type,
    canEdit: f.can_edit,
    sectionKey: fieldIdToSectionKey[f.id] ?? "main",
    value: data.row.cells[f.source_column_id],
  }));

  return NextResponse.json({
    rowId: data.row.id,
    fields,
    loadedAt: new Date().toISOString(),
  });
}
