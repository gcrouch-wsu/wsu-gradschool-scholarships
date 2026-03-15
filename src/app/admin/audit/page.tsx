import { getSessionUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { AuditLogView } from "./AuditLogView";

export default async function AuditPage() {
  const user = await getSessionUser();
  if (!user?.is_platform_admin) {
    return (
      <div className="text-zinc-600">
        You do not have permission to view audit logs.
      </div>
    );
  }

  const { rows: cycles } = await query<{ id: string; cycle_label: string; program_name: string }>(
    `SELECT c.id, c.cycle_label, p.name as program_name
     FROM scholarship_cycles c
     JOIN scholarship_programs p ON p.id = c.program_id
     ORDER BY p.name, c.cycle_label DESC`
  );

  const actionTypes = [
    "user.created",
    "user.password_reset",
    "user.status_changed",
    "program.created",
    "program_admin.added",
    "program_admin.removed",
    "connection.created",
    "connection.program_assigned",
    "connection.verified",
    "connection.rotated",
    "cycle.created",
    "cycle.updated",
    "cycle.config_updated",
    "cycle.config_cloned",
    "cycle.config_imported",
    "cycle.config_published",
    "assignment.created",
    "assignment.removed",
    "reviewer.score_saved",
    "app_config.updated",
    "template.created",
  ];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-zinc-900">Audit / Activity</h1>
      <p className="mb-4 text-sm text-zinc-600">
        Platform admin only. Recent actions across the system.
      </p>
      <AuditLogView cycles={cycles} actionTypes={actionTypes} />
    </div>
  );
}
