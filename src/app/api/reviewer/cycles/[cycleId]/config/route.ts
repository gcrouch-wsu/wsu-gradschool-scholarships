import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getLiveColumnIds } from "@/lib/reviewer";
import { query } from "@/lib/db";
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

  const { rows: membership } = await query<{ role_id: string }>(
    `SELECT role_id FROM scholarship_memberships m
     JOIN scholarship_cycles c ON c.id = m.cycle_id
     WHERE m.user_id = $1 AND m.cycle_id = $2 AND m.status = 'active' AND c.status = 'active'`,
    [user.id, cycleId]
  );
  if (membership.length === 0) {
    return NextResponse.json({ error: "Not assigned to this cycle" }, { status: 403 });
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
    [cycleId, membership[0]!.role_id]
  );

  const { rows: viewConfigs } = await query<{ view_type: string; settings_json: unknown; layout_json: unknown }>(
    "SELECT view_type, settings_json, layout_json FROM view_configs WHERE cycle_id = $1 LIMIT 1",
    [cycleId]
  );
  const { rows: viewSections } = await query<{
    id: string;
    section_key: string;
    label: string;
    sort_order: number;
  }>(
    `SELECT vs.id, vs.section_key, vs.label, vs.sort_order
     FROM view_sections vs
     JOIN view_configs vc ON vc.id = vs.view_config_id
     WHERE vc.cycle_id = $1 ORDER BY vs.sort_order`,
    [cycleId]
  );
  const { rows: sectionFields } = await query<{
    view_section_id: string;
    field_config_id: string;
  }>(
    `SELECT sf.view_section_id, sf.field_config_id
     FROM section_fields sf
     JOIN view_sections vs ON vs.id = sf.view_section_id
     JOIN view_configs vc ON vc.id = vs.view_config_id
     WHERE vc.cycle_id = $1`,
    [cycleId]
  );
  const fieldIdToSectionKey = Object.fromEntries(
    sectionFields.map((sf) => {
      const vs = viewSections.find((s) => s.id === sf.view_section_id);
      return [sf.field_config_id, vs?.section_key ?? "main"];
    })
  );

  const { rows: editPermissions } = await query<{
    field_config_id: string;
    source_column_id: number;
  }>(
    `SELECT fc.id as field_config_id, fc.source_column_id
     FROM field_configs fc
     JOIN field_permissions fp ON fp.field_config_id = fc.id
     WHERE fc.cycle_id = $1 AND fp.role_id = $2 AND fp.can_edit = true`,
    [cycleId, membership[0]!.role_id]
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
  const validEditableIds = editPermissions
    .filter((p) => liveColumnIds.has(String(p.source_column_id)))
    .map((p) => p.source_column_id);

  const showAttachments = fieldConfigs.some(
    (f) => f.purpose === "attachment" || f.display_type === "attachment_list"
  );
  const reviewerAttachmentSchema = await getReviewerAttachmentSchemaStatus();
  const canUploadAttachments = reviewerAttachmentSchema.available && showAttachments;

  const viewSettings = viewConfigs[0]?.settings_json as {
    colors?: Record<string, string>;
    pinnedFieldKeys?: string[];
    hiddenFieldKeys?: string[];
    blindReview?: boolean;
  } | null;
  const blindReview = viewSettings?.blindReview ?? false;
  const hiddenFieldKeys = new Set(viewSettings?.hiddenFieldKeys ?? []);

  const fieldsForReview = blindReview
    ? validFields.filter((f) => !hiddenFieldKeys.has(f.field_key))
    : validFields;
  const layoutJson = readLayoutJsonOrFallback(
    viewConfigs[0]?.layout_json,
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
      knownFieldKeys: validFields.map((field) => field.field_key),
      pinnedFieldKeys: viewSettings?.pinnedFieldKeys ?? [],
      requireAllPlaced: false,
      allowedSectionKeys: (viewSections.length > 0 ? viewSections : [{ section_key: "main", label: "Review", sort_order: 0 }]).map((section) => section.section_key),
    }
  );

  return NextResponse.json({
    fieldConfigs: fieldsForReview,
    editableColumnIds: validEditableIds,
    columnOptions,
    showAttachments,
    canUploadAttachments,
    viewType: viewConfigs[0]?.view_type ?? "tabbed",
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
