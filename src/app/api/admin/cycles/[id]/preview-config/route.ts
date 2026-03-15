import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canManageCycle } from "@/lib/admin";
import { getLiveColumnIds } from "@/lib/reviewer";
import { query } from "@/lib/db";

/**
 * Returns reviewer config for admin preview. Uses the first role in the cycle
 * so admins can see what a reviewer would see.
 */
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
      { error: "No roles configured. Add at least one role to preview." },
      { status: 400 }
    );
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

  const { rows: fieldConfigs } = await query<{
    id: string;
    field_key: string;
    source_column_id: number;
    purpose: string;
    display_label: string;
    display_type: string;
    sort_order: number;
  }>(
    `SELECT fc.id, fc.field_key, fc.source_column_id, fc.purpose, fc.display_label, fc.display_type, fc.sort_order
     FROM field_configs fc
     JOIN field_permissions fp ON fp.field_config_id = fc.id
     WHERE fc.cycle_id = $1 AND fp.role_id = $2 AND fp.can_view = true
     ORDER BY fc.sort_order`,
    [cycleId, roleId]
  );

  const { rows: editPermissions } = await query<{
    field_config_id: string;
    source_column_id: number;
  }>(
    `SELECT fc.id as field_config_id, fc.source_column_id
     FROM field_configs fc
     JOIN field_permissions fp ON fp.field_config_id = fc.id
     WHERE fc.cycle_id = $1 AND fp.role_id = $2 AND fp.can_edit = true`,
    [cycleId, roleId]
  );

  const liveColumnIds = await getLiveColumnIds(cycleId);
  if (!liveColumnIds) {
    return NextResponse.json(
      { error: "Could not verify sheet schema. Check connection and sheet." },
      { status: 400 }
    );
  }

  const schema = cycle.sheet_schema_snapshot_json as {
    columns?: Array<{ id: number; title: string; type: string; options?: string[] }>;
  };
  const columns = schema?.columns ?? [];
  const columnOptions: Record<number, string[]> = {};
  for (const col of columns) {
    if (col.options?.length && liveColumnIds.has(String(col.id)))
      columnOptions[col.id] = col.options;
  }

  const validFields = fieldConfigs.filter(
    (f) =>
      (f.purpose !== "attachment" && f.display_type !== "attachment_list") &&
      liveColumnIds.has(String(f.source_column_id))
  );
  const validEditableIds = editPermissions
    .filter((p) => liveColumnIds.has(String(p.source_column_id)))
    .map((p) => p.source_column_id);

  const showAttachments = fieldConfigs.some(
    (f) => f.purpose === "attachment" || f.display_type === "attachment_list"
  );

  return NextResponse.json({
    fieldConfigs: validFields,
    editableColumnIds: validEditableIds,
    columnOptions,
    showAttachments,
  });
}
