import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canManageCycle } from "@/lib/admin";
import { logAudit } from "@/lib/audit";
import { query, withTransaction } from "@/lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: cycleId } = await params;
  const { canManageCycle } = await import("@/lib/admin");
  const canManage = await canManageCycle(user.id, user.is_platform_admin, cycleId);
  if (!canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { rows: cycles } = await query<{
    sheet_schema_snapshot_json: unknown;
    sheet_id: number | null;
  }>(
    "SELECT sheet_schema_snapshot_json, sheet_id FROM scholarship_cycles WHERE id = $1",
    [cycleId]
  );
  const cycle = cycles[0];
  if (!cycle || !cycle.sheet_schema_snapshot_json) {
    return NextResponse.json(
      { error: "Cycle has no schema. Import schema first." },
      { status: 400 }
    );
  }

  const schema = cycle.sheet_schema_snapshot_json as {
    columns?: Array<{ id: number; index: number; title: string; type?: string; options?: string[]; locked?: boolean }>;
  };
  const sheetColumns = schema.columns ?? [];
  const columns = [
    { id: 0, index: -1, title: "Attachments (row-level)", type: "attachment_list", options: undefined, locked: false },
    ...sheetColumns.map((c) => {
      const rawType = c.type;
      return {
        id: c.id,
        index: c.index,
        title: c.title,
        type: typeof rawType === "string" && rawType ? rawType : "TEXT_NUMBER",
        options: c.options,
        locked: c.locked ?? false,
      };
    }),
  ];

  const { rows: fieldConfigs } = await query<{
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
    [cycleId]
  );

  const { rows: roles } = await query<{ id: string; key: string; label: string }>(
    "SELECT id, key, label FROM roles WHERE cycle_id = $1 ORDER BY sort_order",
    [cycleId]
  );

  const { rows: permissions } = await query<{
    field_config_id: string;
    role_id: string;
    can_view: boolean;
    can_edit: boolean;
  }>(
    `SELECT fp.field_config_id, fp.role_id, fp.can_view, fp.can_edit
     FROM field_permissions fp
     JOIN field_configs fc ON fc.id = fp.field_config_id
     WHERE fc.cycle_id = $1`,
    [cycleId]
  );

  const { rows: viewConfigs } = await query<{
    id: string;
    view_type: string;
    name: string;
    settings_json: unknown;
  }>("SELECT id, view_type, name, settings_json FROM view_configs WHERE cycle_id = $1", [
    cycleId,
  ]);

  const { rows: viewSections } = await query<{
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
    [cycleId]
  );

  const { rows: sectionFields } = await query<{
    view_section_id: string;
    field_config_id: string;
    sort_order: number;
  }>(
    `SELECT sf.view_section_id, sf.field_config_id, sf.sort_order
     FROM section_fields sf
     JOIN view_sections vs ON vs.id = sf.view_section_id
     JOIN view_configs vc ON vc.id = vs.view_config_id
     WHERE vc.cycle_id = $1`,
    [cycleId]
  );

  return NextResponse.json({
    columns,
    fieldConfigs,
    roles,
    permissions,
    viewConfigs,
    viewSections,
    sectionFields,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: cycleId } = await params;
  const { canManageCycle } = await import("@/lib/admin");
  const canManage = await canManageCycle(user.id, user.is_platform_admin, cycleId);
  if (!canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = await request.json();

  const {
    fieldConfigs,
    viewType,
    sections,
    colors,
    pinnedFieldKeys,
    purposeOverrides,
  }: {
    colors?: Record<string, string>;
    pinnedFieldKeys?: string[];
    purposeOverrides?: Record<string, { label?: string; desc?: string; editable?: boolean }>;
    fieldConfigs: Array<{
      fieldKey: string;
      sourceColumnId: number;
      sourceColumnTitle: string;
      purpose: string;
      displayLabel: string;
      displayType: string;
      sortOrder: number;
      sectionKey?: string;
      permissions?: Array<{ roleId: string; canView: boolean; canEdit: boolean }>;
    }>;
    viewType?: string;
    sections?: Array<{ section_key: string; label: string; sort_order: number }>;
  } = body;

  if (!Array.isArray(fieldConfigs)) {
    return NextResponse.json(
      { error: "fieldConfigs array is required" },
      { status: 400 }
    );
  }

  const validPurposes = ["identity", "subtitle", "narrative", "score", "comments", "metadata", "attachment", "status"];
  const validDisplayTypes = ["header", "short_text", "long_text", "score_select", "textarea", "badge", "number", "attachment_list"];

  const result = await withTransaction(async (tx) => {
  await tx("DELETE FROM field_configs WHERE cycle_id = $1", [cycleId]);

  for (let i = 0; i < fieldConfigs.length; i++) {
    const fc = fieldConfigs[i];
    if (!fc?.fieldKey || !fc.purpose || !fc.displayLabel || !fc.displayType) continue;
    const isAttachment = fc.purpose === "attachment" || fc.displayType === "attachment_list";
    const sourceColumnId = isAttachment ? 0 : fc.sourceColumnId;
    if (!isAttachment && (sourceColumnId == null || sourceColumnId === undefined)) continue;
    const purpose = validPurposes.includes(fc.purpose) ? fc.purpose : "metadata";
    const displayType = validDisplayTypes.includes(fc.displayType) ? fc.displayType : "short_text";

    const { rows } = await tx<{ id: string }>(
      `INSERT INTO field_configs (cycle_id, field_key, source_column_id, source_column_title, purpose, display_label, display_type, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        cycleId,
        fc.fieldKey,
        sourceColumnId ?? 0,
        fc.sourceColumnTitle ?? "",
        purpose,
        fc.displayLabel,
        displayType,
        fc.sortOrder ?? i,
      ]
    );
    const fieldConfigId = rows[0]?.id;
    if (!fieldConfigId) continue;

    const { rows: cycleRoles } = await tx<{ id: string }>(
      "SELECT id FROM roles WHERE cycle_id = $1",
      [cycleId]
    );
    const validRoleIds = new Set(cycleRoles.map((r) => r.id));
    const perms = Array.isArray(fc.permissions) ? fc.permissions : [];
    if (perms.length > 0) {
      for (const p of perms) {
        if (!validRoleIds.has(p.roleId)) continue;
        await tx(
          `INSERT INTO field_permissions (field_config_id, role_id, can_view, can_edit)
           VALUES ($1, $2, $3, $4)`,
          [fieldConfigId, p.roleId, p.canView !== false, p.canEdit === true]
        );
      }
    } else {
      const purposeEditable = purposeOverrides?.[fc.purpose]?.editable;
      const canEdit = purposeEditable !== undefined
        ? purposeEditable
        : (fc.purpose === "score" || fc.purpose === "comments");
      for (const r of cycleRoles) {
        await tx(
          `INSERT INTO field_permissions (field_config_id, role_id, can_view, can_edit)
           VALUES ($1, $2, true, $3)`,
          [fieldConfigId, r.id, canEdit]
        );
      }
    }
  }

  const { rows: existingVc } = await tx<{ settings_json: unknown }>(
    "SELECT settings_json FROM view_configs WHERE cycle_id = $1 LIMIT 1",
    [cycleId]
  );
  const existingSettings = (existingVc[0]?.settings_json as Record<string, unknown>) ?? {};
  const preserveKeys = ["blindReview"];
  const preserved = Object.fromEntries(
    preserveKeys.filter((k) => existingSettings[k] !== undefined).map((k) => [k, existingSettings[k]])
  );

  await tx("DELETE FROM view_configs WHERE cycle_id = $1", [cycleId]);
  const vt = viewType || "tabbed";
  if (["tabbed", "stacked", "accordion", "list_detail"].includes(vt)) {
    const { rows: vcRows } = await tx<{ id: string }>(
      `INSERT INTO view_configs (cycle_id, view_type, name, settings_json)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [cycleId, vt, "Review", JSON.stringify({
        colors: colors ?? {},
        pinnedFieldKeys: pinnedFieldKeys ?? [],
        purposeOverrides: purposeOverrides ?? {},
        ...preserved,
      })]
    );
    const viewConfigId = vcRows[0]?.id;
    if (viewConfigId) {
      const usesSections = ["tabbed", "stacked", "accordion"].includes(vt);
      const sectionList = usesSections && Array.isArray(sections) && sections.length > 0
        ? sections
        : [{ section_key: "main", label: "Review", sort_order: 0 }];
      const sectionKeyToId: Record<string, string> = {};
      for (let i = 0; i < sectionList.length; i++) {
        const s = sectionList[i]!;
        const { rows: vsRows } = await tx<{ id: string }>(
          `INSERT INTO view_sections (view_config_id, section_key, label, sort_order)
           VALUES ($1, $2, $3, $4)
           RETURNING id`,
          [viewConfigId, s.section_key, s.label, s.sort_order ?? i]
        );
        if (vsRows[0]?.id) sectionKeyToId[s.section_key] = vsRows[0].id;
      }
      const { rows: fcRows } = await tx<{ id: string; field_key: string }>(
        "SELECT id, field_key FROM field_configs WHERE cycle_id = $1 ORDER BY sort_order",
        [cycleId]
      );
      const fieldKeyToId = Object.fromEntries(fcRows.map((r) => [r.field_key, r.id]));
      const defaultSectionKey = sectionList[0]?.section_key ?? "main";
      for (let i = 0; i < fcRows.length; i++) {
        const fc = fcRows[i]!;
        const fcPayload = fieldConfigs[i];
        const sectionKey = (fcPayload?.sectionKey && sectionKeyToId[fcPayload.sectionKey])
          ? fcPayload.sectionKey
          : defaultSectionKey;
        const viewSectionId = sectionKeyToId[sectionKey];
        if (viewSectionId && fc.id) {
          await tx(
            `INSERT INTO section_fields (view_section_id, field_config_id, sort_order)
             VALUES ($1, $2, $3)`,
            [viewSectionId, fc.id, i]
          );
        }
      }
    }
  }

  const { rows: versionRows } = await tx<{ max: number }>(
    "SELECT COALESCE(MAX(version_number), 0) + 1 as max FROM config_versions WHERE cycle_id = $1",
    [cycleId]
  );
  const versionNumber = versionRows[0]?.max ?? 1;

  const { rows: snapshotRoles } = await tx<{ id: string; key: string; label: string; sort_order: number }>(
    "SELECT id, key, label, sort_order FROM roles WHERE cycle_id = $1 ORDER BY sort_order",
    [cycleId]
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
    [cycleId]
  );
  const { rows: snapshotPermissions } = await tx<{
    field_config_id: string;
    role_id: string;
    can_view: boolean;
    can_edit: boolean;
  }>(
    `SELECT fp.field_config_id, fp.role_id, fp.can_view, fp.can_edit
     FROM field_permissions fp
     JOIN field_configs fc ON fc.id = fp.field_config_id
     WHERE fc.cycle_id = $1`,
    [cycleId]
  );
  const { rows: snapshotViewConfigs } = await tx<{
    id: string;
    view_type: string;
    name: string;
    settings_json: unknown;
  }>("SELECT id, view_type, name, settings_json FROM view_configs WHERE cycle_id = $1", [cycleId]);
  const { rows: snapshotViewSections } = await tx<{
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
    [cycleId]
  );
  const { rows: snapshotSectionFields } = await tx<{
    view_section_id: string;
    field_config_id: string;
    sort_order: number;
  }>(
    `SELECT sf.view_section_id, sf.field_config_id, sf.sort_order
     FROM section_fields sf
     JOIN view_sections vs ON vs.id = sf.view_section_id
     JOIN view_configs vc ON vc.id = vs.view_config_id
     WHERE vc.cycle_id = $1`,
    [cycleId]
  );
  const { rows: cycleMeta } = await tx<{ sheet_id: number | null; sheet_name: string | null }>(
    "SELECT sheet_id, sheet_name FROM scholarship_cycles WHERE id = $1",
    [cycleId]
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

  const { rows: cvRows } = await tx<{ id: string }>(
    `INSERT INTO config_versions (cycle_id, version_number, status, snapshot_json, created_by_user_id)
     VALUES ($1, $2, 'draft', $3, $4)
     RETURNING id`,
    [cycleId, versionNumber, JSON.stringify(snapshot), user.id]
  );

  return { versionNumber, configVersionId: cvRows[0]?.id };
  });

  await logAudit({
    actorUserId: user.id,
    cycleId,
    actionType: "cycle.config_updated",
    targetType: "cycle",
    targetId: cycleId,
    metadata: {
      fieldConfigCount: fieldConfigs.length,
      viewType,
      configVersionId: result.configVersionId,
      versionNumber: result.versionNumber,
    },
  });

  return NextResponse.json({ success: true });
}
