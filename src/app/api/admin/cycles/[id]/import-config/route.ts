import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canManageCycle } from "@/lib/admin";
import { logAudit } from "@/lib/audit";
import { withTransaction } from "@/lib/db";
import {
  buildReviewerLayoutFromFields,
  validateLayoutJson,
} from "@/lib/layout";

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
  const { roles, fieldConfigs, permissions, viewSections, sectionFields } = body;
  if (!Array.isArray(roles) || !Array.isArray(fieldConfigs)) {
    return NextResponse.json(
      { error: "roles and fieldConfigs arrays are required" },
      { status: 400 }
    );
  }

  const viewType = body.viewConfigs?.[0]?.view_type ?? "tabbed";
  const importedSections =
    Array.isArray(viewSections) && viewSections.length > 0
      ? viewSections.map((section: { section_key: string; label: string; sort_order?: number }, index: number) => ({
          section_key: section.section_key,
          label: section.label,
          sort_order: index,
        }))
      : [{ section_key: "main", label: "Review", sort_order: 0 }];
  const sectionByFieldKey = new Map<string, string>();
  for (const sectionField of Array.isArray(sectionFields) ? sectionFields : []) {
    if (
      typeof sectionField?.field_key === "string" &&
      typeof sectionField?.section_key === "string"
    ) {
      sectionByFieldKey.set(sectionField.field_key, sectionField.section_key);
    }
  }
  const importedPinnedFieldKeys = Array.isArray(body.viewConfigs?.[0]?.settings_json?.pinnedFieldKeys)
    ? body.viewConfigs[0].settings_json.pinnedFieldKeys.filter(
        (fieldKey: unknown): fieldKey is string => typeof fieldKey === "string"
      )
    : [];
  const reviewerLayoutCandidate =
    body.viewConfigs?.[0]?.layout_json ??
    buildReviewerLayoutFromFields(
      fieldConfigs.map((fieldConfig: { field_key: string; sort_order?: number }) => ({
        fieldKey: fieldConfig.field_key,
        sectionKey: sectionByFieldKey.get(fieldConfig.field_key),
        sortOrder: fieldConfig.sort_order,
        pinned: importedPinnedFieldKeys.includes(fieldConfig.field_key),
      })),
      importedSections,
      importedPinnedFieldKeys
    );
  const layoutValidation = validateLayoutJson(reviewerLayoutCandidate, {
    knownFieldKeys: fieldConfigs.map((fieldConfig: { field_key: string }) => fieldConfig.field_key),
    pinnedFieldKeys: importedPinnedFieldKeys,
    requireAllPlaced: true,
    allowedSectionKeys: importedSections.map((section: { section_key: string }) => section.section_key),
  });
  if (!layoutValidation.ok) {
    return NextResponse.json(
      { error: `Imported reviewer layout is invalid: ${layoutValidation.error}` },
      { status: 400 }
    );
  }

  const skippedRoles: string[] = [];

  await withTransaction(async (tx) => {
    await tx(
      "DELETE FROM field_permissions WHERE field_config_id IN (SELECT id FROM field_configs WHERE cycle_id = $1)",
      [targetCycleId]
    );
    await tx("DELETE FROM section_fields WHERE view_section_id IN (SELECT id FROM view_sections WHERE view_config_id IN (SELECT id FROM view_configs WHERE cycle_id = $1))", [targetCycleId]);
    await tx("DELETE FROM view_sections WHERE view_config_id IN (SELECT id FROM view_configs WHERE cycle_id = $1)", [targetCycleId]);
    await tx("DELETE FROM view_configs WHERE cycle_id = $1", [targetCycleId]);
    await tx("DELETE FROM field_configs WHERE cycle_id = $1", [targetCycleId]);

    // Merge roles by key: update existing, insert new (cap=10), skip if at cap.
    // Deduplicate imported roles by key first (keep first occurrence).
    const seenImportKeys = new Set<string>();
    const deduplicatedRoles = roles.filter((r: { key?: string }, i: number) => {
      const key = r.key ?? `role_${i}`;
      if (seenImportKeys.has(key)) return false;
      seenImportKeys.add(key);
      return true;
    });

    const { rows: existingRoles } = await tx<{ id: string; key: string }>(
      "SELECT id, key FROM roles WHERE cycle_id = $1",
      [targetCycleId]
    );
    const existingByKey = new Map(existingRoles.map((r) => [r.key, r.id]));
    let existingCount = existingRoles.length;

    const roleKeyToId = new Map<string, string>();
    for (let i = 0; i < deduplicatedRoles.length; i++) {
      const r = deduplicatedRoles[i];
      const key = r.key ?? `role_${i}`;
      const label = r.label ?? key;
      const sortOrder = r.sort_order ?? i;

      const existingId = existingByKey.get(key);
      if (existingId) {
        await tx(
          "UPDATE roles SET label = $1, sort_order = $2 WHERE id = $3",
          [label, sortOrder, existingId]
        );
        roleKeyToId.set(key, existingId);
      } else {
        if (existingCount >= 10) {
          skippedRoles.push(label);
          continue;
        }
        const { rows } = await tx<{ id: string }>(
          "INSERT INTO roles (cycle_id, key, label, sort_order) VALUES ($1, $2, $3, $4) RETURNING id",
          [targetCycleId, key, label, sortOrder]
        );
        roleKeyToId.set(key, rows[0]!.id);
        existingCount++;
      }
    }

    const fieldKeyToConfigId = new Map<string, string>();
    for (let i = 0; i < fieldConfigs.length; i++) {
      const fc = fieldConfigs[i];
      const fieldKey = fc.field_key ?? `field_${i}`;
      const { rows } = await tx<{ id: string }>(
        `INSERT INTO field_configs (cycle_id, field_key, source_column_id, source_column_title, purpose, display_label, help_text, display_type, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          targetCycleId,
          fieldKey,
          fc.source_column_id ?? 0,
          fc.source_column_title ?? "",
          fc.purpose ?? "metadata",
          fc.display_label ?? fieldKey,
          typeof fc.help_text === "string" && fc.help_text.trim() ? fc.help_text.trim() : null,
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
          [fieldConfigId, roleId, p.can_view !== false || p.can_edit === true, p.can_edit === true]
        );
      }
    }

    if (["tabbed", "stacked", "accordion", "list_detail"].includes(viewType)) {
      const { rows: vcRows } = await tx<{ id: string }>(
        `INSERT INTO view_configs (cycle_id, view_type, name, settings_json, layout_json)
         VALUES ($1, $2, 'Review', $3, $4) RETURNING id`,
        [
          targetCycleId,
          viewType,
          JSON.stringify(body.viewConfigs?.[0]?.settings_json ?? {}),
          JSON.stringify(layoutValidation.normalized),
        ]
      );
      const viewConfigId = vcRows[0]?.id;
      if (viewConfigId) {
        const usesSections = ["tabbed", "stacked", "accordion"].includes(viewType);
        const sectionsForLegacyTables = usesSections
          ? importedSections
          : [{ section_key: "main", label: "Review", sort_order: 0 }];
        const sectionKeyToId = new Map<string, string>();
        for (const [index, section] of sectionsForLegacyTables.entries()) {
          const { rows: vsRows } = await tx<{ id: string }>(
            `INSERT INTO view_sections (view_config_id, section_key, label, sort_order)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [viewConfigId, section.section_key, section.label, index]
          );
          if (vsRows[0]?.id) {
            sectionKeyToId.set(section.section_key, vsRows[0].id);
          }
        }
        const { rows: fcRows } = await tx<{ id: string; field_key: string }>(
          "SELECT id, field_key FROM field_configs WHERE cycle_id = $1 ORDER BY sort_order",
          [targetCycleId]
        );
        const defaultSectionKey = sectionsForLegacyTables[0]?.section_key ?? "main";
        for (const [index, fieldConfig] of fcRows.entries()) {
          const sectionKey = sectionByFieldKey.get(fieldConfig.field_key) ?? defaultSectionKey;
          const sectionId = sectionKeyToId.get(sectionKey) ?? sectionKeyToId.get(defaultSectionKey);
          if (sectionId) {
            await tx(
              "INSERT INTO section_fields (view_section_id, field_config_id, sort_order) VALUES ($1, $2, $3)",
              [sectionId, fieldConfig.id, index]
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
      help_text: string | null;
      display_type: string;
      sort_order: number;
    }>(
      "SELECT id, field_key, source_column_id, source_column_title, purpose, display_label, help_text, display_type, sort_order FROM field_configs WHERE cycle_id = $1 ORDER BY sort_order",
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
      layout_json: layoutValidation.normalized,
      viewSections: snapshotViewSections,
      sectionFields: snapshotSectionFields,
      sheetMetadata: cycleMeta[0] ?? {},
    };

    await tx(
      "INSERT INTO config_versions (cycle_id, version_number, status, snapshot_json, created_by_user_id) VALUES ($1, $2, 'draft', $3, $4)",
      [targetCycleId, versionNumber, JSON.stringify(snapshot), user.id]
    );
  });

  const warnings: string[] = skippedRoles.map(
    (label) => `Role "${label}" was skipped — the 10-role limit was reached.`
  );

  await logAudit({
    actorUserId: user.id,
    cycleId: targetCycleId,
    actionType: "cycle.config_imported",
    targetType: "cycle",
    targetId: targetCycleId,
    metadata: { fieldConfigCount: fieldConfigs.length, skippedRoles },
  });

  return NextResponse.json({ success: true, warnings });
}
