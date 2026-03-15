/**
 * Scholarship admin model: platform admin vs program-scoped scholarship admin.
 * Scholarship admins manage cycle operations for programs they're assigned to.
 * Connections (raw tokens) remain platform-admin only.
 */
import { query } from "./db";

export async function getAdminProgramIds(userId: string): Promise<"all" | string[]> {
  const { rows } = await query<{ program_id: string }>(
    "SELECT program_id FROM program_admins WHERE user_id = $1",
    [userId]
  );
  return rows.map((r) => r.program_id);
}

export async function canAccessAdmin(userId: string, isPlatformAdmin: boolean): Promise<boolean> {
  if (isPlatformAdmin) return true;
  const programIds = await getAdminProgramIds(userId);
  return programIds.length > 0;
}

export async function canManageProgram(
  userId: string,
  isPlatformAdmin: boolean,
  programId: string
): Promise<boolean> {
  if (isPlatformAdmin) return true;
  const { rows } = await query<{ id: string }>(
    "SELECT id FROM program_admins WHERE user_id = $1 AND program_id = $2",
    [userId, programId]
  );
  return rows.length > 0;
}

export async function canManageCycle(
  userId: string,
  isPlatformAdmin: boolean,
  cycleId: string
): Promise<boolean> {
  if (isPlatformAdmin) return true;
  const { rows } = await query<{ program_id: string }>(
    "SELECT program_id FROM scholarship_cycles WHERE id = $1",
    [cycleId]
  );
  const programId = rows[0]?.program_id;
  if (!programId) return false;
  return canManageProgram(userId, isPlatformAdmin, programId);
}
