import { query } from "./db";

interface SchemaColumn {
  id: number;
  title: string;
  type?: string;
}

interface FieldConfigMappingRow {
  id: string;
  source_column_id: number;
  source_column_title: string | null;
}

interface IntakeFieldMappingRow {
  id: string;
  target_column_id: number | null;
  target_column_title: string | null;
  target_column_type: string | null;
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
      };
    })
    .filter((update): update is { id: string; source_column_id: number; source_column_title: string } => update !== null);
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
        if (
          currentById.title !== (mapping.target_column_title ?? "") ||
          (currentById.type ?? null) !== (mapping.target_column_type ?? null)
        ) {
          return {
            id: mapping.id,
            target_column_id: currentById.id,
            target_column_title: currentById.title,
            target_column_type: currentById.type ?? null,
          };
        }
        return null;
      }

      const matchedByTitle = uniqueByTitle.get(normalizeTitle(mapping.target_column_title));
      if (!matchedByTitle) return null;

      return {
        id: mapping.id,
        target_column_id: matchedByTitle.id,
        target_column_title: matchedByTitle.title,
        target_column_type: matchedByTitle.type ?? null,
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
      } => update !== null
    );
}

export async function reconcileCycleFieldMappings(
  cycleId: string,
  columns: SchemaColumn[],
  runQuery: QueryLike = query
) {
  const { rows } = await runQuery<FieldConfigMappingRow>(
    "SELECT id, source_column_id, source_column_title FROM field_configs WHERE cycle_id = $1",
    [cycleId]
  );

  const updates = planFieldConfigReconciliation(rows, columns);
  for (const update of updates) {
    await runQuery(
      "UPDATE field_configs SET source_column_id = $1, source_column_title = $2 WHERE id = $3",
      [update.source_column_id, update.source_column_title, update.id]
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
    `SELECT iff.id, iff.target_column_id, iff.target_column_title, iff.target_column_type
     FROM intake_form_fields iff
     JOIN intake_forms f ON f.id = iff.intake_form_id
     WHERE f.cycle_id = $1`,
    [cycleId]
  );

  const updates = planIntakeFieldReconciliation(rows, columns);
  for (const update of updates) {
    await runQuery(
      `UPDATE intake_form_fields
       SET target_column_id = $1, target_column_title = $2, target_column_type = $3
       WHERE id = $4`,
      [update.target_column_id, update.target_column_title, update.target_column_type, update.id]
    );
  }

  return { updated: updates.length };
}
