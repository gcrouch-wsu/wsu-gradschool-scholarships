import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { query } from "@/lib/db";

const KEYS = [
  "idle_session_timeout_minutes",
  "session_warning_minutes",
  "smartsheet_write_timeout_seconds",
] as const;

const RANGES: Record<string, { min: number; max: number }> = {
  idle_session_timeout_minutes: { min: 15, max: 480 },
  session_warning_minutes: { min: 1, max: 60 },
  smartsheet_write_timeout_seconds: { min: 15, max: 60 },
};

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.is_platform_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { rows } = await query<{ key: string; value_json: unknown }>(
    "SELECT key, value_json FROM app_config WHERE key = ANY($1)",
    [KEYS]
  );
  const config: Record<string, number> = {};
  for (const r of rows) {
    const v = r.value_json;
    config[r.key] = typeof v === "number" ? v : parseInt(String(v), 10) || 0;
  }
  return NextResponse.json(config);
}

export async function PATCH(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.is_platform_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const updates: Array<{ key: string; value: number }> = [];
  const invalid: string[] = [];

  for (const key of KEYS) {
    const v = body[key];
    if (v === undefined) continue;
    const num = typeof v === "number" ? v : parseInt(String(v), 10);
    if (isNaN(num)) {
      invalid.push(`${key}: must be a number`);
      continue;
    }
    const range = RANGES[key];
    if (range && (num < range.min || num > range.max)) {
      invalid.push(`${key}: must be between ${range.min} and ${range.max}`);
      continue;
    }
    updates.push({ key, value: num });
  }

  if (invalid.length > 0) {
    return NextResponse.json(
      { error: "Invalid values", details: invalid },
      { status: 400 }
    );
  }
  if (updates.length === 0) {
    return NextResponse.json({ error: "No valid updates" }, { status: 400 });
  }

  for (const { key, value } of updates) {
    await query(
      `UPDATE app_config SET value_json = $1, updated_at = now() WHERE key = $2`,
      [JSON.stringify(value), key]
    );
  }

  await logAudit({
    actorUserId: user.id,
    actionType: "app_config.updated",
    targetType: "app_config",
    metadata: { keys: updates.map((u) => u.key), values: Object.fromEntries(updates.map((u) => [u.key, u.value])) },
  });

  return NextResponse.json({ success: true });
}
