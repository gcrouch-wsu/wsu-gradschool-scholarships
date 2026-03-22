import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canManageCycle } from "@/lib/admin";
import { logAudit } from "@/lib/audit";
import { query, withTransaction } from "@/lib/db";

/**
 * Clone field config, roles, permissions, and view config from a source cycle to the target cycle.
 * Source and target must be in the same program. Target gets schema from source if it has none.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: targetCycleId } = await params;
  const canManageTarget = await canManageCycle(user.id, user.is_platform_admin, targetCycleId);
  if (!canManageTarget) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { sourceCycleId } = body;
  if (!sourceCycleId || typeof sourceCycleId !== "string") {
    return NextResponse.json(
      { error: "sourceCycleId is required" },
      { status: 400 }
    );
  }

  if (sourceCycleId === targetCycleId) {
    return NextResponse.json(
      { error: "Source and target must be different cycles" },
      { status: 400 }
    );
  }

  const canManageSource = await canManageCycle(user.id, user.is_platform_admin, sourceCycleId);
  if (!canManageSource) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { rows: sourceRows } = await query<{
    program_id: string;
    sheet_schema_snapshot_json: unknown;
    schema_synced_at: string | null;
    schema_status: string | null;
  }>(
    "SELECT program_id, sheet_schema_snapshot_json, schema_synced_at, schema_status FROM scholarship_cycles WHERE id = $1",
    [sourceCycleId]
  );
  const { rows: targetRows } = await query<{ program_id: string; sheet_schema_snapshot_json: unknown }>(
    "SELECT program_id, sheet_schema_snapshot_json FROM scholarship_cycles WHERE id = $1",
    [targetCycleId]
  );
  const sourceCycle = sourceRows[0];
  const targetCycle = targetRows[0];
  if (!sourceCycle || !targetCycle || sourceCycle.program_id !== targetCycle.program_id) {
    return NextResponse.json(
      { error: "Source and target must be in the same program" },
      { status: 400 }
    );
  }

  const { rows: sourceRoles } = await query<{ id: string; key: string; label: string; sort_order: number }>(
    "SELECT id, key, label, sort_order FROM roles WHERE cycle_id = $1 ORDER BY sort_order",
    [sourceCycleId]
  );
  if (sourceRoles.length === 0) {
    return NextResponse.json(
      { error: "Source cycle has no roles to copy" },
      { status: 400 }
    );
  }

  const { rows: sourceFieldConfigs } = await query<{
    id: string;
    field_key: string;
    source_column_id: number;
    source_column_title: string;
    purpose: string;
    display_label: string;
    display_type: string;
    sort_order: number;
  }>(
    "SELECT id, field_key, source_column_id, source_column_title, purpose, display_label, display_type, sort_order FROM field_configs WHERE cycle_id = $1 ORDER BY sort_order",
    [sourceCycleId]
  );

  const { rows: sourcePermissions } = await query<{
    field_config_id: string;
    role_id: string;
    can_view: boolean;
    can_edit: boolean;
  }>(
    `SELECT fp.field_config_id, fp.role_id, fp.can_view, fp.can_edit
     FROM field_permissions fp
     JOIN field_configs fc ON fc.id = fp.field_config_id
     WHERE fc.cycle_id = $1`,
    [sourceCycleId]
  );

  const { rows: sourceViewConfigs } = await query<{
    id: string;
    view_type: string;
    name: string;
    settings_json: unknown;
    layout_json: unknown;
  }>("SELECT id, view_type, name, settings_json, layout_json FROM view_configs WHERE cycle_id = $1", [
    sourceCycleId,
  ]);

  const { rows: sourceViewSections } = await query<{
    id: string;
    view_config_id: string;
    section_key: string;
    label: string;
    sort_order: number;
  }>(
    `SELECT vs.id, vs.view_config_id, vs.section_key, vs.label, vs.sort_order
     FROM view_sections vs
     JOIN view_configs vc ON vc.id = vs.view_config_id
     WHERE vc.cycle_id = $1 ORDER BY vs.sort_order`,
    [sourceCycleId]
  );

  const { rows: sourceSectionFields } = await query<{
    view_section_id: string;
    field_config_id: string;
    sort_order: number;
  }>(
    `SELECT sf.view_section_id, sf.field_config_id, sf.sort_order
     FROM section_fields sf
     JOIN view_sections vs ON vs.id = sf.view_section_id
     JOIN view_configs vc ON vc.id = vs.view_config_id
     WHERE vc.cycle_id = $1`,
    [sourceCycleId]
  );

  await withTransaction(async (tx) => {
  await tx("DELETE FROM field_configs WHERE cycle_id = $1", [targetCycleId]);
  await tx("DELETE FROM roles WHERE cycle_id = $1", [targetCycleId]);
  await tx("DELETE FROM view_configs WHERE cycle_id = $1", [targetCycleId]);

  const roleIdMap = new Map<string, string>();
  for (const r of sourceRoles) {
    const { rows } = await tx<{ id: string }>(
      "INSERT INTO roles (cycle_id, key, label, sort_order) VALUES ($1, $2, $3, $4) RETURNING id",
      [targetCycleId, r.key, r.label, r.sort_order]
    );
    roleIdMap.set(r.id, rows[0]!.id);
  }

  const fieldConfigIdMap = new Map<string, string>();
  for (const fc of sourceFieldConfigs) {
    const { rows } = await tx<{ id: string }>(
      `INSERT INTO field_configs (cycle_id, field_key, source_column_id, source_column_title, purpose, display_label, display_type, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [
        targetCycleId,
        fc.field_key,
        fc.source_column_id,
        fc.source_column_title ?? "",
        fc.purpose,
        fc.display_label,
        fc.display_type,
        fc.sort_order,
      ]
    );
    fieldConfigIdMap.set(fc.id, rows[0]!.id);
  }

  for (const p of sourcePermissions) {
    const newFcId = fieldConfigIdMap.get(p.field_config_id);
    const newRoleId = roleIdMap.get(p.role_id);
    if (newFcId && newRoleId) {
      await tx(
        "INSERT INTO field_permissions (field_config_id, role_id, can_view, can_edit) VALUES ($1, $2, $3, $4)",
        [newFcId, newRoleId, p.can_view, p.can_edit]
      );
    }
  }

  const viewConfigIdMap = new Map<string, string>();
  for (const vc of sourceViewConfigs) {
    const { rows } = await tx<{ id: string }>(
      "INSERT INTO view_configs (cycle_id, view_type, name, settings_json, layout_json) VALUES ($1, $2, $3, $4, $5) RETURNING id",
      [
        targetCycleId,
        vc.view_type,
        vc.name,
        vc.settings_json ? JSON.stringify(vc.settings_json) : "{}",
        vc.layout_json ? JSON.stringify(vc.layout_json) : null,
      ]
    );
    viewConfigIdMap.set(vc.id, rows[0]!.id);
  }

  const viewSectionIdMap = new Map<string, string>();
  for (const vs of sourceViewSections) {
    const newVcId = viewConfigIdMap.get(vs.view_config_id);
    if (newVcId) {
      const { rows } = await tx<{ id: string }>(
        "INSERT INTO view_sections (view_config_id, section_key, label, sort_order) VALUES ($1, $2, $3, $4) RETURNING id",
        [newVcId, vs.section_key, vs.label, vs.sort_order]
      );
      viewSectionIdMap.set(vs.id, rows[0]!.id);
    }
  }

  for (const sf of sourceSectionFields) {
    const newVsId = viewSectionIdMap.get(sf.view_section_id);
    const newFcId = fieldConfigIdMap.get(sf.field_config_id);
    if (newVsId && newFcId) {
      await tx(
        "INSERT INTO section_fields (view_section_id, field_config_id, sort_order) VALUES ($1, $2, $3)",
        [newVsId, newFcId, sf.sort_order]
      );
    }
  }

  if (!targetCycle.sheet_schema_snapshot_json && sourceCycle.sheet_schema_snapshot_json) {
    await tx(
      `UPDATE scholarship_cycles SET
        sheet_schema_snapshot_json = $1,
        schema_synced_at = $2,
        schema_status = $3,
        updated_at = now()
       WHERE id = $4`,
      [
        sourceCycle.sheet_schema_snapshot_json,
        sourceCycle.schema_synced_at,
        sourceCycle.schema_status,
        targetCycleId,
      ]
    );
  }

  const { rows: versionRows } = await tx<{ max: number }>(
    "SELECT COALESCE(MAX(version_number), 0) + 1 as max FROM config_versions WHERE cycle_id = $1",
    [targetCycleId]
  );
  const versionNumber = versionRows[0]?.max ?? 1;

  const { rows: snapshotRoles } = await tx<{ id: string; key: string; label: string; sort_order: number }>(
    "SELECT id, key, label, sort_order FROM roles WHERE cycle_id = $1 ORDER BY sort_order",
    [targetCycleId]
  );
  const { rows: snapshotFieldConfigs } = await tx<{
    id: string;
    field_key: string;
    source_column_id: number;
    source_column_title: string;
    purpose: string;
    display_label: string;
    display_type: string;
    sort_order: number;
  }>(
    "SELECT id, field_key, source_column_id, source_column_title, purpose, display_label, display_type, sort_order FROM field_configs WHERE cycle_id = $1 ORDER BY sort_order",
    [targetCycleId]
  );
  const { rows: snapshotPermissions } = await tx<{
    field_config_id: string;
    role_id: string;
    can_view: boolean;
    can_edit: boolean;
  }>(
    "SELECT fp.field_config_id, fp.role_id, fp.can_view, fp.can_edit FROM field_permissions fp JOIN field_configs fc ON fc.id = fp.field_config_id WHERE fc.cycle_id = $1",
    [targetCycleId]
  );
  const { rows: snapshotViewConfigs } = await tx<{
    id: string;
    view_type: string;
    name: string;
    settings_json: unknown;
    layout_json: unknown;
  }>("SELECT id, view_type, name, settings_json, layout_json FROM view_configs WHERE cycle_id = $1", [targetCycleId]);
  const { rows: snapshotViewSections } = await tx<{
    id: string;
    view_config_id: string;
    section_key: string;
    label: string;
    sort_order: number;
  }>(
    "SELECT vs.id, vs.view_config_id, vs.section_key, vs.label, vs.sort_order FROM view_sections vs JOIN view_configs vc ON vc.id = vs.view_config_id WHERE vc.cycle_id = $1 ORDER BY vs.sort_order",
    [targetCycleId]
  );
  const { rows: snapshotSectionFields } = await tx<{
    view_section_id: string;
    field_config_id: string;
    sort_order: number;
  }>(
    "SELECT sf.view_section_id, sf.field_config_id, sf.sort_order FROM section_fields sf JOIN view_sections vs ON vs.id = sf.view_section_id JOIN view_configs vc ON vc.id = vs.view_config_id WHERE vc.cycle_id = $1",
    [targetCycleId]
  );
  const { rows: cycleMeta } = await tx<{ sheet_id: number | null; sheet_name: string | null }>(
    "SELECT sheet_id, sheet_name FROM scholarship_cycles WHERE id = $1",
    [targetCycleId]
  );

  const snapshot = {
    versionNumber,
    roles: snapshotRoles,
    fieldConfigs: snapshotFieldConfigs,
    permissions: snapshotPermissions,
    viewConfigs: snapshotViewConfigs,
    layout_json: snapshotViewConfigs[0]?.layout_json ?? null,
    viewSections: snapshotViewSections,
    sectionFields: snapshotSectionFields,
    sheetMetadata: cycleMeta[0] ?? {},
  };

  await tx(
    "INSERT INTO config_versions (cycle_id, version_number, status, snapshot_json, created_by_user_id) VALUES ($1, $2, 'draft', $3, $4)",
    [targetCycleId, versionNumber, JSON.stringify(snapshot), user.id]
  );
  });

  await logAudit({
    actorUserId: user.id,
    cycleId: targetCycleId,
    actionType: "cycle.config_cloned",
    targetType: "cycle",
    targetId: targetCycleId,
    metadata: { sourceCycleId, fieldConfigCount: sourceFieldConfigs.length },
  });

  return NextResponse.json({
    success: true,
    rolesCopied: sourceRoles.length,
    fieldConfigsCopied: sourceFieldConfigs.length,
  });
}
