/**
 * Reviewer data access - shared between API routes and server components.
 */
import { query } from "./db";
import { decrypt } from "./encryption";
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

  const { rows: identityFields } = await query<{
    source_column_id: number;
    field_key: string;
  }>(
    `SELECT source_column_id, field_key FROM field_configs fc
     JOIN field_permissions fp ON fp.field_config_id = fc.id
     WHERE fc.cycle_id = $1 AND fp.role_id = $2 AND fp.can_view = true
     AND fc.purpose IN ('identity', 'subtitle')`,
    [cycleId, membership[0]!.role_id]
  );

  const result = await getSheetRows(token, cycle.sheet_id);
  if (!result.ok || !result.rows) return null;

  return result.rows.map((row) => {
    const identity: Record<string, unknown> = {};
    let displayName = "";
    for (const f of identityFields) {
      const val = row.cells[f.source_column_id] ?? "";
      identity[f.field_key] = val;
      if (!displayName && val) displayName = String(val);
    }
    if (!displayName) displayName = `Row ${row.id}`;
    return {
      id: row.id,
      displayName,
      identity,
    };
  });
}
