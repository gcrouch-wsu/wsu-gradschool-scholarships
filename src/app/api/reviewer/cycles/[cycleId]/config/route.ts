import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getLiveColumnIds } from "@/lib/reviewer";
import { query } from "@/lib/db";
import { getEffectiveReviewerConfig } from "@/lib/reviewer-config";
import {
  getReviewerRoleFields,
  getVisibleReviewerRoleFields,
  isReviewerAttachmentField,
} from "@/lib/reviewer-field-access";
import {
  buildReviewerLayoutFromFields,
  readLayoutJsonOrFallback,
} from "@/lib/layout";
import { getReviewerAttachmentSchemaStatus } from "@/lib/reviewer-attachments";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ cycleId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { cycleId } = await params;

  const { rows: membership } = await query<{ role_id: string; cycle_status: string }>(
    `SELECT m.role_id, c.status AS cycle_status
     FROM scholarship_memberships m
     JOIN scholarship_cycles c ON c.id = m.cycle_id
     WHERE m.user_id = $1 AND m.cycle_id = $2 AND m.status = 'active'`,
    [user.id, cycleId]
  );
  if (membership.length === 0) {
    return NextResponse.json({ error: "You are not assigned to this review cycle." }, { status: 403 });
  }
  if (membership[0]!.cycle_status !== "active") {
    return NextResponse.json({ error: "This cycle is not currently open for review." }, { status: 403 });
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

  const effectiveConfig = await getEffectiveReviewerConfig(cycleId);
  const viewConfig = effectiveConfig.viewConfig;
  const roleFieldConfigs = getReviewerRoleFields(
    effectiveConfig.fieldConfigs,
    effectiveConfig.permissions,
    membership[0]!.role_id,
    viewConfig?.settings_json
  );
  const visibleRoleFieldConfigs = getVisibleReviewerRoleFields(roleFieldConfigs);
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
    if (col.options?.length && liveColumnIds.has(String(col.id))) columnOptions[col.id] = col.options;
  }

  const validFields = visibleRoleFieldConfigs
    .filter(
      (f) =>
        !isReviewerAttachmentField(f) &&
        liveColumnIds.has(String(f.source_column_id))
    )
    .map((f) => ({
      ...f,
      section_key: fieldIdToSectionKey[f.id] ?? "main",
    }));
  const validEditableIds = visibleRoleFieldConfigs
    .filter((fieldConfig) => fieldConfig.can_edit && liveColumnIds.has(String(fieldConfig.source_column_id)))
    .map((fieldConfig) => fieldConfig.source_column_id);

  const visibleAttachmentFields = visibleRoleFieldConfigs.filter(isReviewerAttachmentField);
  const showAttachments = visibleAttachmentFields.length > 0;
  const attachmentHelpText = visibleAttachmentFields[0]?.help_text ?? null;
  const reviewerAttachmentSchema = await getReviewerAttachmentSchemaStatus();
  const canUploadAttachments =
    reviewerAttachmentSchema.available &&
    visibleAttachmentFields.some((fieldConfig) => fieldConfig.can_edit);

  const viewSettings = viewConfig?.settings_json as {
    colors?: Record<string, string>;
    pinnedFieldKeys?: string[];
  } | null;
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
    fieldConfigs: validFields,
    editableColumnIds: validEditableIds,
    columnOptions,
    showAttachments,
    attachmentHelpText,
    canUploadAttachments,
    viewType: viewConfig?.view_type ?? "tabbed",
    layoutJson,
    viewSections: viewSections.map((s) => ({
      section_key: s.section_key,
      label: s.label,
      sort_order: s.sort_order,
    })),
    colors: viewSettings?.colors ?? {},
    pinnedFieldKeys: viewSettings?.pinnedFieldKeys ?? [],
  });
}
