import { query } from "./db";

interface SchemaColumn {
  id: number;
  title: string;
  type?: string;
  options?: string[];
}

interface FieldConfigMappingRow {
  id: string;
  source_column_id: number;
  source_column_title: string | null;
  display_label: string;
}

interface IntakeFieldMappingRow {
  id: string;
  target_column_id: number | null;
  target_column_title: string | null;
  target_column_type: string | null;
  label: string;
  field_type: string;
  settings_json: unknown;
}

type QueryLike = typeof query;

function normalizeTitle(title: string | null | undefined): string {
  return (title ?? "").trim().toLowerCase();
}

function buildUniqueTitleMap(columns: SchemaColumn[]) {
  const grouped = new Map<string, SchemaColumn[]>();
  for (const column of columns) {
    const normalized = normalizeTitle(column.title);
    if (!normalized) continue;
    grouped.set(normalized, [...(grouped.get(normalized) ?? []), column]);
  }

  const unique = new Map<string, SchemaColumn>();
  for (const [title, matches] of grouped) {
    if (matches.length === 1) {
      unique.set(title, matches[0]!);
    }
  }
  return unique;
}

function inferIntakeFieldTypeFromColumnType(type: string | undefined): string {
  if (type === "PICKLIST") return "select";
  if (type === "DATE") return "date";
  if (type === "CHECKBOX") return "checkbox";
  return "short_text";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIntakeFieldTypeCompatible(fieldType: string, columnType: string | undefined): boolean {
  if (columnType === "PICKLIST") return fieldType === "select";
  if (columnType === "DATE") return fieldType === "date";
  if (columnType === "CHECKBOX") return fieldType === "checkbox";
  return ["short_text", "long_text", "email", "number"].includes(fieldType);
}

function buildReconciledIntakeSettings(
  nextFieldType: string,
  nextColumn: SchemaColumn,
  currentSettings: unknown
) {
  const settings = isPlainObject(currentSettings) ? currentSettings : {};

  if (nextFieldType === "select" && nextColumn.type === "PICKLIST") {
    return { options: [...(nextColumn.options ?? [])] };
  }

  if (nextFieldType === "short_text" || nextFieldType === "long_text") {
    return settings.maxLength !== undefined ? { maxLength: settings.maxLength } : {};
  }

  return {};
}

export function planFieldConfigReconciliation(
  mappings: FieldConfigMappingRow[],
  columns: SchemaColumn[]
) {
  const byId = new Map(columns.map((column) => [column.id, column]));
  const uniqueByTitle = buildUniqueTitleMap(columns);

  return mappings
    .map((mapping) => {
      const currentById = byId.get(mapping.source_column_id);
      if (currentById) {
        if (currentById.title !== (mapping.source_column_title ?? "")) {
          return {
            id: mapping.id,
            source_column_id: currentById.id,
            source_column_title: currentById.title,
            display_label:
              mapping.display_label === (mapping.source_column_title ?? "")
                ? currentById.title
                : mapping.display_label,
          };
        }
        return null;
      }

      const matchedByTitle = uniqueByTitle.get(normalizeTitle(mapping.source_column_title));
      if (!matchedByTitle) return null;

      return {
        id: mapping.id,
        source_column_id: matchedByTitle.id,
        source_column_title: matchedByTitle.title,
        display_label:
          mapping.display_label === (mapping.source_column_title ?? "")
            ? matchedByTitle.title
            : mapping.display_label,
      };
    })
    .filter(
      (
        update
      ): update is {
        id: string;
        source_column_id: number;
        source_column_title: string;
        display_label: string;
      } => update !== null
    );
}

export function planIntakeFieldReconciliation(
  mappings: IntakeFieldMappingRow[],
  columns: SchemaColumn[]
) {
  const byId = new Map(columns.map((column) => [column.id, column]));
  const uniqueByTitle = buildUniqueTitleMap(columns);

  return mappings
    .map((mapping) => {
      if (!mapping.target_column_id && !mapping.target_column_title) return null;

      const currentById =
        typeof mapping.target_column_id === "number" ? byId.get(mapping.target_column_id) : undefined;
      if (currentById) {
        const oldTitle = mapping.target_column_title ?? "";
        const nextFieldType = isIntakeFieldTypeCompatible(mapping.field_type, currentById.type)
          ? mapping.field_type
          : inferIntakeFieldTypeFromColumnType(currentById.type);
        const nextSettings = buildReconciledIntakeSettings(
          nextFieldType,
          currentById,
          mapping.settings_json
        );
        const currentSettingsJson = JSON.stringify(isPlainObject(mapping.settings_json) ? mapping.settings_json : {});
        const nextSettingsJson = JSON.stringify(nextSettings);

        if (
          currentById.title !== oldTitle ||
          (currentById.type ?? null) !== (mapping.target_column_type ?? null) ||
          nextFieldType !== mapping.field_type ||
          nextSettingsJson !== currentSettingsJson
        ) {
          return {
            id: mapping.id,
            target_column_id: currentById.id,
            target_column_title: currentById.title,
            target_column_type: currentById.type ?? null,
            label: mapping.label === oldTitle ? currentById.title : mapping.label,
            field_type: nextFieldType,
            settings_json: nextSettings,
          };
        }
        return null;
      }

      const matchedByTitle = uniqueByTitle.get(normalizeTitle(mapping.target_column_title));
      if (!matchedByTitle) return null;

      const nextFieldType = isIntakeFieldTypeCompatible(mapping.field_type, matchedByTitle.type)
        ? mapping.field_type
        : inferIntakeFieldTypeFromColumnType(matchedByTitle.type);

      return {
        id: mapping.id,
        target_column_id: matchedByTitle.id,
        target_column_title: matchedByTitle.title,
        target_column_type: matchedByTitle.type ?? null,
        label:
          mapping.label === (mapping.target_column_title ?? "")
            ? matchedByTitle.title
            : mapping.label,
        field_type: nextFieldType,
        settings_json: buildReconciledIntakeSettings(
          nextFieldType,
          matchedByTitle,
          mapping.settings_json
        ),
      };
    })
    .filter(
      (
        update
      ): update is {
        id: string;
        target_column_id: number;
        target_column_title: string;
        target_column_type: string | null;
        label: string;
        field_type: string;
        settings_json: Record<string, unknown>;
      } => update !== null
    );
}

export async function reconcileCycleFieldMappings(
  cycleId: string,
  columns: SchemaColumn[],
  runQuery: QueryLike = query
) {
  const { rows } = await runQuery<FieldConfigMappingRow>(
    "SELECT id, source_column_id, source_column_title, display_label FROM field_configs WHERE cycle_id = $1",
    [cycleId]
  );

  const updates = planFieldConfigReconciliation(rows, columns);
  for (const update of updates) {
    await runQuery(
      "UPDATE field_configs SET source_column_id = $1, source_column_title = $2, display_label = $3 WHERE id = $4",
      [update.source_column_id, update.source_column_title, update.display_label, update.id]
    );
  }

  return { updated: updates.length };
}

export async function reconcileCycleIntakeMappings(
  cycleId: string,
  columns: SchemaColumn[],
  runQuery: QueryLike = query
) {
  const { rows } = await runQuery<IntakeFieldMappingRow>(
    `SELECT iff.id, iff.target_column_id, iff.target_column_title, iff.target_column_type, iff.label, iff.field_type, iff.settings_json
     FROM intake_form_fields iff
     JOIN intake_forms f ON f.id = iff.intake_form_id
     WHERE f.cycle_id = $1`,
    [cycleId]
  );

  const updates = planIntakeFieldReconciliation(rows, columns);
  for (const update of updates) {
    await runQuery(
      `UPDATE intake_form_fields
       SET target_column_id = $1, target_column_title = $2, target_column_type = $3,
           label = $4, field_type = $5, settings_json = $6, updated_at = now()
       WHERE id = $7`,
      [
        update.target_column_id,
        update.target_column_title,
        update.target_column_type,
        update.label,
        update.field_type,
        JSON.stringify(update.settings_json),
        update.id,
      ]
    );
  }

  return { updated: updates.length };
}
