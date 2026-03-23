import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canManageCycle } from "@/lib/admin";
import { getLiveColumnIds } from "@/lib/reviewer";
import { query } from "@/lib/db";
import { getEffectiveReviewerConfig } from "@/lib/reviewer-config";
import {
  buildReviewerLayoutFromFields,
  readLayoutJsonOrFallback,
} from "@/lib/layout";

/**
 * Returns reviewer config for admin preview. Accepts optional ?roleId= to simulate
 * a specific role; falls back to the first role if omitted or invalid.
 */
export async function GET(
  request: Request,
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

  const requestedRoleId = new URL(request.url).searchParams.get("roleId");

  const { rows: allRoles } = await query<{ id: string; key: string; label: string; sort_order: number }>(
    "SELECT id, key, label, sort_order FROM roles WHERE cycle_id = $1 ORDER BY sort_order",
    [cycleId]
  );
  if (allRoles.length === 0) {
    return NextResponse.json(
      { error: "No roles configured. Add at least one role to preview." },
      { status: 400 }
    );
  }
  const roleId =
    requestedRoleId && allRoles.some((r) => r.id === requestedRoleId)
      ? requestedRoleId
      : allRoles[0]!.id;

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

  const effectiveConfig = await getEffectiveReviewerConfig(cycleId);
  const rolePermissions = effectiveConfig.permissions.filter(
    (permission) => permission.role_id === roleId
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
  const viewConfig = effectiveConfig.viewConfig;
  const viewSections = effectiveConfig.viewSections;
  const sectionFields = effectiveConfig.sectionFields;
  const fieldIdToSectionKey = Object.fromEntries(
    sectionFields.map((sf) => {
      const vs = viewSections.find((s) => s.id === sf.view_section_id);
      return [sf.field_config_id, vs?.section_key ?? "main"];
    })
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

  const validFields = fieldConfigs
    .filter(
      (f) =>
        (f.purpose !== "attachment" && f.display_type !== "attachment_list") &&
        liveColumnIds.has(String(f.source_column_id))
    )
    .map((f) => ({
      ...f,
      section_key: fieldIdToSectionKey[f.id] ?? "main",
    }));
  const validEditableIds = fieldConfigs
    .filter((fieldConfig) => fieldConfig.can_edit && liveColumnIds.has(String(fieldConfig.source_column_id)))
    .map((fieldConfig) => fieldConfig.source_column_id);

  const showAttachments = fieldConfigs.some(
    (f) => f.purpose === "attachment" || f.display_type === "attachment_list"
  );

  const viewSettings = viewConfig?.settings_json as {
    colors?: Record<string, string>;
    pinnedFieldKeys?: string[];
    hiddenFieldKeys?: string[];
    blindReview?: boolean;
  } | null;
  const blindReview = viewSettings?.blindReview ?? false;
  const hiddenFieldKeys = new Set(viewSettings?.hiddenFieldKeys ?? []);
  const fieldsForPreview = blindReview
    ? validFields.filter((field) => !hiddenFieldKeys.has(field.field_key))
    : validFields;
  const layoutJson = readLayoutJsonOrFallback(
    viewConfig?.layout_json,
    buildReviewerLayoutFromFields(
      validFields.map((field) => ({
        fieldKey: field.field_key,
        sectionKey: field.section_key,
        sortOrder: field.sort_order,
        pinned: (viewSettings?.pinnedFieldKeys ?? []).includes(field.field_key),
      })),
      viewSections.length > 0 ? viewSections : [{ section_key: "main", label: "Review", sort_order: 0 }],
      viewSettings?.pinnedFieldKeys ?? []
    ),
    {
      knownFieldKeys: effectiveConfig.fieldConfigs.map((f) => f.field_key),
      pinnedFieldKeys: viewSettings?.pinnedFieldKeys ?? [],
      requireAllPlaced: false,
      allowedSectionKeys: (viewSections.length > 0 ? viewSections : [{ section_key: "main", label: "Review", sort_order: 0 }]).map((section) => section.section_key),
    }
  );

  return NextResponse.json({
    fieldConfigs: fieldsForPreview,
    editableColumnIds: validEditableIds,
    columnOptions,
    showAttachments,
    viewType: viewConfig?.view_type ?? "tabbed",
    layoutJson,
    viewSections: viewSections.map((s) => ({
      section_key: s.section_key,
      label: s.label,
      sort_order: s.sort_order,
    })),
    colors: viewSettings?.colors ?? {},
    pinnedFieldKeys: viewSettings?.pinnedFieldKeys ?? [],
    roles: allRoles,
    activeRoleId: roleId,
  });
}
