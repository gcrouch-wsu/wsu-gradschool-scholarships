import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canManageCycle } from "@/lib/admin";
import { query } from "@/lib/db";

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

  const { rows: roles } = await query<{ id: string; key: string; label: string; sort_order: number }>(
    "SELECT id, key, label, sort_order FROM roles WHERE cycle_id = $1 ORDER BY sort_order",
    [cycleId]
  );
  const { rows: fieldConfigs } = await query<{
    field_key: string;
    source_column_id: number;
    source_column_title: string;
    purpose: string;
    display_label: string;
    help_text: string | null;
    display_type: string;
    sort_order: number;
  }>(
    "SELECT field_key, source_column_id, source_column_title, purpose, display_label, help_text, display_type, sort_order FROM field_configs WHERE cycle_id = $1 ORDER BY sort_order",
    [cycleId]
  );
  const { rows: permissions } = await query<{
    field_key: string;
    role_key: string;
    can_view: boolean;
    can_edit: boolean;
  }>(
    `SELECT fc.field_key, r.key as role_key, fp.can_view, fp.can_edit
     FROM field_permissions fp
     JOIN field_configs fc ON fc.id = fp.field_config_id
     JOIN roles r ON r.id = fp.role_id
     WHERE fc.cycle_id = $1`,
    [cycleId]
  );
  const { rows: viewConfigs } = await query<{
    view_type: string;
    name: string;
    settings_json: unknown;
    layout_json: unknown;
  }>("SELECT view_type, name, settings_json, layout_json FROM view_configs WHERE cycle_id = $1", [cycleId]);
  const { rows: viewSections } = await query<{
    section_key: string;
    label: string;
    sort_order: number;
  }>(
    `SELECT vs.section_key, vs.label, vs.sort_order
     FROM view_sections vs
     JOIN view_configs vc ON vc.id = vs.view_config_id
     WHERE vc.cycle_id = $1
     ORDER BY vs.sort_order`,
    [cycleId]
  );
  const { rows: sectionFields } = await query<{
    section_key: string;
    field_key: string;
    sort_order: number;
  }>(
    `SELECT vs.section_key, fc.field_key, sf.sort_order
     FROM section_fields sf
     JOIN view_sections vs ON vs.id = sf.view_section_id
     JOIN view_configs vc ON vc.id = vs.view_config_id
     JOIN field_configs fc ON fc.id = sf.field_config_id
     WHERE vc.cycle_id = $1
     ORDER BY sf.sort_order`,
    [cycleId]
  );
  const { rows: cycle } = await query<{
    cycle_key: string;
    cycle_label: string;
    sheet_id: number | null;
    sheet_name: string | null;
    sheet_schema_snapshot_json: unknown;
  }>(
    "SELECT cycle_key, cycle_label, sheet_id, sheet_name, sheet_schema_snapshot_json FROM scholarship_cycles WHERE id = $1",
    [cycleId]
  );

  const exportData = {
    version: 1,
    exportedAt: new Date().toISOString(),
    cycleKey: cycle[0]?.cycle_key,
    cycleLabel: cycle[0]?.cycle_label,
    sheetId: cycle[0]?.sheet_id,
    sheetName: cycle[0]?.sheet_name,
    schemaSnapshot: cycle[0]?.sheet_schema_snapshot_json,
    roles,
    fieldConfigs,
    permissions,
    viewConfigs,
    viewSections,
    sectionFields,
  };

  return NextResponse.json(exportData);
}
