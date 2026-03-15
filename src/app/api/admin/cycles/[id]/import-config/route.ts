import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canManageCycle } from "@/lib/admin";
import { logAudit } from "@/lib/audit";
import { query, withTransaction } from "@/lib/db";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: targetCycleId } = await params;
  const canManage = await canManageCycle(user.id, user.is_platform_admin, targetCycleId);
  if (!canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { roles, fieldConfigs, permissions } = body;
  if (!Array.isArray(roles) || !Array.isArray(fieldConfigs)) {
    return NextResponse.json(
      { error: "roles and fieldConfigs arrays are required" },
      { status: 400 }
    );
  }

  await withTransaction(async (tx) => {
    await tx(
      "DELETE FROM field_permissions WHERE field_config_id IN (SELECT id FROM field_configs WHERE cycle_id = $1)",
      [targetCycleId]
    );
    await tx("DELETE FROM section_fields WHERE view_section_id IN (SELECT id FROM view_sections WHERE view_config_id IN (SELECT id FROM view_configs WHERE cycle_id = $1))", [targetCycleId]);
    await tx("DELETE FROM view_sections WHERE view_config_id IN (SELECT id FROM view_configs WHERE cycle_id = $1)", [targetCycleId]);
    await tx("DELETE FROM view_configs WHERE cycle_id = $1", [targetCycleId]);
    await tx("DELETE FROM field_configs WHERE cycle_id = $1", [targetCycleId]);
    await tx("DELETE FROM roles WHERE cycle_id = $1", [targetCycleId]);

    const roleKeyToId = new Map<string, string>();
    for (const r of roles) {
      const key = r.key ?? `role_${roleKeyToId.size}`;
      const label = r.label ?? key;
      const sortOrder = r.sort_order ?? roleKeyToId.size;
      const { rows } = await tx<{ id: string }>(
        "INSERT INTO roles (cycle_id, key, label, sort_order) VALUES ($1, $2, $3, $4) RETURNING id",
        [targetCycleId, key, label, sortOrder]
      );
      roleKeyToId.set(key, rows[0]!.id);
    }

    const fieldKeyToConfigId = new Map<string, string>();
    for (let i = 0; i < fieldConfigs.length; i++) {
      const fc = fieldConfigs[i];
      const fieldKey = fc.field_key ?? `field_${i}`;
      const { rows } = await tx<{ id: string }>(
        `INSERT INTO field_configs (cycle_id, field_key, source_column_id, source_column_title, purpose, display_label, display_type, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [
          targetCycleId,
          fieldKey,
          fc.source_column_id ?? 0,
          fc.source_column_title ?? "",
          fc.purpose ?? "metadata",
          fc.display_label ?? fieldKey,
          fc.display_type ?? "short_text",
          fc.sort_order ?? i,
        ]
      );
      fieldKeyToConfigId.set(fieldKey, rows[0]!.id);
    }

    const perms = Array.isArray(permissions) ? permissions : [];
    for (const p of perms) {
      const roleId = p.role_key ? roleKeyToId.get(p.role_key) : null;
      const fieldConfigId = p.field_key ? fieldKeyToConfigId.get(p.field_key) : null;
      if (roleId && fieldConfigId) {
        await tx(
          "INSERT INTO field_permissions (field_config_id, role_id, can_view, can_edit) VALUES ($1, $2, $3, $4)",
          [fieldConfigId, roleId, p.can_view !== false, p.can_edit === true]
        );
      }
    }

    const viewType = body.viewConfigs?.[0]?.view_type ?? "tabbed";
    if (["tabbed", "stacked", "accordion", "list_detail"].includes(viewType)) {
      const { rows: vcRows } = await tx<{ id: string }>(
        `INSERT INTO view_configs (cycle_id, view_type, name, settings_json)
         VALUES ($1, $2, 'Review', '{}') RETURNING id`,
        [targetCycleId, viewType]
      );
      const viewConfigId = vcRows[0]?.id;
      if (viewConfigId) {
        const { rows: vsRows } = await tx<{ id: string }>(
          `INSERT INTO view_sections (view_config_id, section_key, label, sort_order)
           VALUES ($1, 'main', 'Review', 0) RETURNING id`,
          [viewConfigId]
        );
        const viewSectionId = vsRows[0]?.id;
        if (viewSectionId) {
          const { rows: fcRows } = await tx<{ id: string }>(
            "SELECT id FROM field_configs WHERE cycle_id = $1 ORDER BY sort_order",
            [targetCycleId]
          );
          for (let i = 0; i < fcRows.length; i++) {
            await tx(
              "INSERT INTO section_fields (view_section_id, field_config_id, sort_order) VALUES ($1, $2, $3)",
              [viewSectionId, fcRows[i]!.id, i]
            );
          }
        }
      }
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
    }>("SELECT id, view_type, name, settings_json FROM view_configs WHERE cycle_id = $1", [targetCycleId]);
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
    actionType: "cycle.config_imported",
    targetType: "cycle",
    targetId: targetCycleId,
    metadata: { fieldConfigCount: fieldConfigs.length },
  });

  return NextResponse.json({ success: true });
}
