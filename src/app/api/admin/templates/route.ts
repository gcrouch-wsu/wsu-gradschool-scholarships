import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canAccessAdmin } from "@/lib/admin";
import { logAudit } from "@/lib/audit";
import { query } from "@/lib/db";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const canAccess = await canAccessAdmin(user.id, user.is_platform_admin);
  if (!canAccess) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { rows } = await query<{
    id: string;
    name: string;
    description: string | null;
    created_at: string;
  }>(
    "SELECT id, name, description, created_at FROM scholarship_templates ORDER BY name"
  );
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user || !user.is_platform_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { name, description, config } = body;
  if (!name || typeof name !== "string" || !config) {
    return NextResponse.json(
      { error: "name and config are required" },
      { status: 400 }
    );
  }

  const { roles, fieldConfigs } = config;
  if (!Array.isArray(roles) || !Array.isArray(fieldConfigs)) {
    return NextResponse.json(
      { error: "config must include roles and fieldConfigs arrays" },
      { status: 400 }
    );
  }

  const { rows } = await query<{ id: string }>(
    `INSERT INTO scholarship_templates (name, description, config_json, created_by_user_id)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [name.trim(), description?.trim() || null, JSON.stringify(config), user.id]
  );
  const templateId = rows[0]!.id;
  await logAudit({
    actorUserId: user.id,
    actionType: "template.created",
    targetType: "template",
    targetId: templateId,
    metadata: { name: name.trim(), fieldConfigCount: fieldConfigs.length },
  });
  return NextResponse.json({ id: templateId, name: name.trim() });
}
