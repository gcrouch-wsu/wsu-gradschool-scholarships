import { query } from "./db";
import type { SavedLayoutJson } from "./layout";

export interface ReviewerFieldConfigRecord {
  id: string;
  field_key: string;
  source_column_id: number;
  source_column_title: string;
  purpose: string;
  display_label: string;
  display_type: string;
  sort_order: number;
}

export interface ReviewerPermissionRecord {
  field_config_id: string;
  role_id: string;
  can_view: boolean;
  can_edit: boolean;
}

export interface ReviewerViewConfigRecord {
  id?: string;
  view_type: string;
  name?: string;
  settings_json: unknown;
  layout_json: unknown;
}

export interface ReviewerViewSectionRecord {
  id: string;
  view_config_id?: string;
  section_key: string;
  label: string;
  sort_order: number;
}

export interface ReviewerSectionFieldRecord {
  view_section_id: string;
  field_config_id: string;
  sort_order?: number;
}

export interface EffectiveReviewerConfig {
  publishedConfigVersionId: string | null;
  isPublishedSnapshot: boolean;
  fieldConfigs: ReviewerFieldConfigRecord[];
  permissions: ReviewerPermissionRecord[];
  viewConfig: ReviewerViewConfigRecord | null;
  viewSections: ReviewerViewSectionRecord[];
  sectionFields: ReviewerSectionFieldRecord[];
}

interface SnapshotShape {
  fieldConfigs?: ReviewerFieldConfigRecord[];
  permissions?: ReviewerPermissionRecord[];
  viewConfigs?: ReviewerViewConfigRecord[];
  layout_json?: unknown;
  viewSections?: ReviewerViewSectionRecord[];
  sectionFields?: ReviewerSectionFieldRecord[];
}

function isSavedLayoutJson(value: unknown): value is SavedLayoutJson {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as { version?: unknown }).version === 1 &&
      Array.isArray((value as { sections?: unknown }).sections)
  );
}

function normalizeSnapshot(snapshot: SnapshotShape, publishedConfigVersionId: string): EffectiveReviewerConfig | null {
  const fieldConfigs = Array.isArray(snapshot.fieldConfigs) ? snapshot.fieldConfigs : [];
  const permissions = Array.isArray(snapshot.permissions) ? snapshot.permissions : [];
  const rawViewSections = Array.isArray(snapshot.viewSections) ? snapshot.viewSections : [];
  let viewSections = rawViewSections;
  let sectionFields = Array.isArray(snapshot.sectionFields) ? snapshot.sectionFields : [];
  const rawViewConfig = Array.isArray(snapshot.viewConfigs) ? snapshot.viewConfigs[0] ?? null : null;
  const snapshotLayout = isSavedLayoutJson(snapshot.layout_json) ? snapshot.layout_json : null;

  if (fieldConfigs.length === 0 || !rawViewConfig) {
    return null;
  }

  const fieldConfigIdByKey = new Map(
    fieldConfigs.map((fieldConfig) => [fieldConfig.field_key, fieldConfig.id])
  );

  if (snapshotLayout) {
    const existingSectionIdByKey = new Map(
      rawViewSections.map((section) => [section.section_key, section.id])
    );
    viewSections = snapshotLayout.sections.map((section, index) => ({
      id: existingSectionIdByKey.get(section.section_key) ?? `snapshot_section_${index}`,
      section_key: section.section_key,
      label: section.label,
      sort_order: section.sort_order ?? index,
    }));

    const viewSectionIdByKey = new Map(
      viewSections.map((section) => [section.section_key, section.id])
    );
    sectionFields = snapshotLayout.sections.flatMap((section) => {
      const viewSectionId = viewSectionIdByKey.get(section.section_key);
      if (!viewSectionId) {
        return [];
      }
      let sortOrder = 0;
      return section.rows.flatMap((row) =>
        row.items.flatMap((item) => {
          const fieldConfigId = fieldConfigIdByKey.get(item.field_key);
          if (!fieldConfigId) {
            return [];
          }
          const record: ReviewerSectionFieldRecord = {
            view_section_id: viewSectionId,
            field_config_id: fieldConfigId,
            sort_order: sortOrder,
          };
          sortOrder += 1;
          return [record];
        })
      );
    });
  }

  return {
    publishedConfigVersionId,
    isPublishedSnapshot: true,
    fieldConfigs,
    permissions,
    viewConfig: {
      ...rawViewConfig,
      layout_json: snapshot.layout_json ?? rawViewConfig.layout_json ?? null,
    },
    viewSections,
    sectionFields,
  };
}

export async function getEffectiveReviewerConfig(cycleId: string): Promise<EffectiveReviewerConfig> {
  const { rows: cycleRows } = await query<{ published_config_version_id: string | null }>(
    "SELECT published_config_version_id FROM scholarship_cycles WHERE id = $1",
    [cycleId]
  );
  const publishedConfigVersionId = cycleRows[0]?.published_config_version_id ?? null;

  if (publishedConfigVersionId) {
    const { rows: snapshotRows } = await query<{ snapshot_json: unknown }>(
      "SELECT snapshot_json FROM config_versions WHERE id = $1",
      [publishedConfigVersionId]
    );
    const snapshot = (snapshotRows[0]?.snapshot_json ?? null) as SnapshotShape | null;
    if (snapshot) {
      const normalized = normalizeSnapshot(snapshot, publishedConfigVersionId);
      if (normalized) {
        return normalized;
      }
    }
  }

  const { rows: fieldConfigs } = await query<ReviewerFieldConfigRecord>(
    `SELECT id, field_key, source_column_id, source_column_title, purpose, display_label, display_type, sort_order
     FROM field_configs
     WHERE cycle_id = $1
     ORDER BY sort_order`,
    [cycleId]
  );
  const { rows: permissions } = await query<ReviewerPermissionRecord>(
    `SELECT fp.field_config_id, fp.role_id, fp.can_view, fp.can_edit
     FROM field_permissions fp
     JOIN field_configs fc ON fc.id = fp.field_config_id
     WHERE fc.cycle_id = $1`,
    [cycleId]
  );
  const { rows: viewConfigs } = await query<ReviewerViewConfigRecord>(
    "SELECT id, view_type, name, settings_json, layout_json FROM view_configs WHERE cycle_id = $1",
    [cycleId]
  );
  const { rows: viewSections } = await query<ReviewerViewSectionRecord>(
    `SELECT vs.id, vs.view_config_id, vs.section_key, vs.label, vs.sort_order
     FROM view_sections vs
     JOIN view_configs vc ON vc.id = vs.view_config_id
     WHERE vc.cycle_id = $1
     ORDER BY vs.sort_order`,
    [cycleId]
  );
  const { rows: sectionFields } = await query<ReviewerSectionFieldRecord>(
    `SELECT sf.view_section_id, sf.field_config_id, sf.sort_order
     FROM section_fields sf
     JOIN view_sections vs ON vs.id = sf.view_section_id
     JOIN view_configs vc ON vc.id = vs.view_config_id
     WHERE vc.cycle_id = $1`,
    [cycleId]
  );

  return {
    publishedConfigVersionId,
    isPublishedSnapshot: false,
    fieldConfigs,
    permissions,
    viewConfig: viewConfigs[0] ?? null,
    viewSections,
    sectionFields,
  };
}
