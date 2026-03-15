/**
 * Audit logging for admin and reviewer actions.
 * Per handoff: admin actions always logged; reviewer saves capture before/after where practical.
 */
import { query } from "./db";

export interface AuditEntry {
  actorUserId?: string | null;
  cycleId?: string | null;
  actionType: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_logs (actor_user_id, cycle_id, action_type, target_type, target_id, metadata_json)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        entry.actorUserId ?? null,
        entry.cycleId ?? null,
        entry.actionType,
        entry.targetType ?? null,
        entry.targetId ?? null,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
      ]
    );
  } catch (err) {
    console.error("[audit] Failed to log:", entry.actionType, err);
  }
}
