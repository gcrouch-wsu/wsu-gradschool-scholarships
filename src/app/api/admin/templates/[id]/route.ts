import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canAccessAdmin } from "@/lib/admin";
import { query } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const canAccess = await canAccessAdmin(user.id, user.is_platform_admin);
  if (!canAccess) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const { rows } = await query<{ name: string; config_json: unknown }>(
    "SELECT name, config_json FROM scholarship_templates WHERE id = $1",
    [id]
  );
  const template = rows[0];
  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }
  const config =
    typeof template.config_json === "object" && template.config_json !== null
      ? template.config_json
      : JSON.parse(String(template.config_json));
  return NextResponse.json({ name: template.name, ...config });
}
