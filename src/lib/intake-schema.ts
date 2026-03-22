import { query } from "./db";

const INTAKE_TABLES = [
  "intake_forms",
  "intake_form_fields",
  "intake_form_versions",
  "intake_submissions",
  "intake_submission_files",
  "intake_rate_limit_events",
] as const;

type IntakeTableName = (typeof INTAKE_TABLES)[number];

interface IntakeSchemaRow extends Record<IntakeTableName, string | null> {}

interface PgErrorLike {
  code?: string;
}

export const INTAKE_SCHEMA_UNAVAILABLE_MESSAGE =
  "Intake form tables are not installed in this database yet. Apply migration 005_intake_forms.sql to enable intake.";

export function isMissingRelationError(error: unknown): error is PgErrorLike {
  return typeof error === "object" && error !== null && (error as PgErrorLike).code === "42P01";
}

export async function getIntakeSchemaStatus() {
  const { rows } = await query<IntakeSchemaRow>(
    `SELECT
      to_regclass('public.intake_forms') AS intake_forms,
      to_regclass('public.intake_form_fields') AS intake_form_fields,
      to_regclass('public.intake_form_versions') AS intake_form_versions,
      to_regclass('public.intake_submissions') AS intake_submissions,
      to_regclass('public.intake_submission_files') AS intake_submission_files,
      to_regclass('public.intake_rate_limit_events') AS intake_rate_limit_events`
  );

  const row = rows[0];
  const missingTables = INTAKE_TABLES.filter((tableName) => !row?.[tableName]);

  return {
    available: missingTables.length === 0,
    missingTables,
  };
}

export function formatIntakeSchemaUnavailableMessage(missingTables?: readonly string[]) {
  if (!missingTables || missingTables.length === 0) {
    return INTAKE_SCHEMA_UNAVAILABLE_MESSAGE;
  }

  return `${INTAKE_SCHEMA_UNAVAILABLE_MESSAGE} Missing tables: ${missingTables.join(", ")}.`;
}
