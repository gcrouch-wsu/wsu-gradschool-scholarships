/**
 * Reviewer data access - shared between API routes and server components.
 */
import { query } from "./db";
import { decrypt } from "./encryption";
import { getEffectiveReviewerConfig } from "./reviewer-config";
import { getSheetRows, getSheetSchema } from "./smartsheet";

/** Fetch live column IDs from Smartsheet for a cycle. Returns null if fetch fails. Uses strings to avoid BIGINT/Number mismatch. */
export async function getLiveColumnIds(cycleId: string): Promise<Set<string> | null> {
  const { rows: cycles } = await query<{ connection_id: string; sheet_id: number }>(
    "SELECT connection_id, sheet_id FROM scholarship_cycles WHERE id = $1",
    [cycleId]
  );
  const cycle = cycles[0];
  if (!cycle?.connection_id || !cycle.sheet_id) return null;

  const { rows: conn } = await query<{ encrypted_credentials: string }>(
    "SELECT encrypted_credentials FROM connections WHERE id = $1",
    [cycle.connection_id]
  );
  if (!conn[0]?.encrypted_credentials) return null;

  let token: string;
  try {
    token = decrypt(conn[0].encrypted_credentials);
  } catch {
    return null;
  }

  const result = await getSheetSchema(token, cycle.sheet_id);
  if (!result.ok || !result.sheet?.columns) return null;

  return new Set(result.sheet.columns.map((c) => String(c.id)));
}

export async function getReviewerNominees(
  userId: string,
  cycleId: string
): Promise<{ id: number; displayName: string; identity: Record<string, unknown> }[] | null> {
  const { rows: membership } = await query<{ role_id: string }>(
    `SELECT role_id FROM scholarship_memberships m
     JOIN scholarship_cycles c ON c.id = m.cycle_id
     WHERE m.user_id = $1 AND m.cycle_id = $2 AND m.status = 'active' AND c.status = 'active'`,
    [userId, cycleId]
  );
  if (membership.length === 0) return null;

  const { rows: cycles } = await query<{
    connection_id: string;
    sheet_id: number;
  }>(
    "SELECT connection_id, sheet_id FROM scholarship_cycles WHERE id = $1",
    [cycleId]
  );
  const cycle = cycles[0];
  if (!cycle?.connection_id || !cycle.sheet_id) return null;

  const { rows: conn } = await query<{ encrypted_credentials: string }>(
    "SELECT encrypted_credentials FROM connections WHERE id = $1",
    [cycle.connection_id]
  );
  if (!conn[0]?.encrypted_credentials) return null;

  let token: string;
  try {
    token = decrypt(conn[0].encrypted_credentials);
  } catch {
    return null;
  }

  const effectiveConfig = await getEffectiveReviewerConfig(cycleId);
  const rolePermissions = effectiveConfig.permissions.filter(
    (permission) => permission.role_id === membership[0]!.role_id
  );
  const viewableFieldIds = new Set(
    rolePermissions
      .filter((permission) => permission.can_view)
      .map((permission) => permission.field_config_id)
  );
  const viewSettings = effectiveConfig.viewConfig?.settings_json as {
    blindReview?: boolean;
    hiddenFieldKeys?: string[];
  } | null;
  const blindReview = viewSettings?.blindReview ?? false;
  const hiddenFieldKeys = new Set(viewSettings?.hiddenFieldKeys ?? []);
  const identityFields = effectiveConfig.fieldConfigs
    .filter(
      (fieldConfig) =>
        viewableFieldIds.has(fieldConfig.id) &&
        (fieldConfig.purpose === "identity" || fieldConfig.purpose === "subtitle") &&
        (!blindReview || !hiddenFieldKeys.has(fieldConfig.field_key))
    )
    .map((fieldConfig) => ({
      source_column_id: fieldConfig.source_column_id,
      field_key: fieldConfig.field_key,
    }));

  const result = await getSheetRows(token, cycle.sheet_id);
  if (!result.ok || !result.rows) return null;

  return result.rows.map((row, index) => {
    const identity: Record<string, unknown> = {};
    for (const f of identityFields) {
      identity[f.field_key] = row.cells[f.source_column_id] ?? "";
    }
    const firstIdentityValue = Object.values(identity).find(
      (value) => value != null && String(value).trim() !== ""
    );
    const displayName = blindReview
      ? `Applicant ${index + 1}`
      : (identity.name as string) ||
        (identity.title as string) ||
        (identity["Applicant Name"] as string) ||
        (firstIdentityValue != null ? String(firstIdentityValue) : null) ||
        `Row ${row.id}`;
    return {
      id: row.id,
      displayName: String(displayName),
      identity,
    };
  });
}
