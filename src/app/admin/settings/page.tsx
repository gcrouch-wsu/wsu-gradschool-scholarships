import { getSessionUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { SettingsForm } from "./SettingsForm";

export default async function SettingsPage() {
  const user = await getSessionUser();
  if (!user?.is_platform_admin) {
    return (
      <div className="text-zinc-600">
        You do not have permission to manage settings.
      </div>
    );
  }

  const { rows } = await query<{ key: string; value_json: unknown }>(
    "SELECT key, value_json FROM app_config WHERE key IN ('idle_session_timeout_minutes', 'session_warning_minutes', 'smartsheet_write_timeout_seconds')"
  );
  const config: Record<string, number> = {};
  for (const r of rows) {
    const v = r.value_json;
    config[r.key] = typeof v === "number" ? v : parseInt(String(v), 10) || 0;
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-zinc-900">Platform settings</h1>
      <p className="mb-4 text-sm text-zinc-600">
        Timeout and session settings. Platform admin only.
      </p>
      <SettingsForm
        idleSessionTimeout={config.idle_session_timeout_minutes ?? 120}
        sessionWarning={config.session_warning_minutes ?? 10}
        smartsheetWriteTimeout={config.smartsheet_write_timeout_seconds ?? 30}
      />
    </div>
  );
}
