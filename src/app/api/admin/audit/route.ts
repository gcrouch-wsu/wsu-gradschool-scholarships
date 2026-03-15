import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { query } from "@/lib/db";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.is_platform_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = request.nextUrl;
  const actionType = searchParams.get("actionType");
  const cycleId = searchParams.get("cycleId");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "100", 10), 500);
  const offset = Math.max(0, parseInt(searchParams.get("offset") ?? "0", 10));

  const conditions: string[] = [];
  const params: unknown[] = [];
  let i = 1;

  if (actionType) {
    conditions.push(`a.action_type = $${i++}`);
    params.push(actionType);
  }
  if (cycleId) {
    conditions.push(`a.cycle_id = $${i++}`);
    params.push(cycleId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit, offset);

  const { rows } = await query<{
    id: string;
    actor_user_id: string | null;
    cycle_id: string | null;
    action_type: string;
    target_type: string | null;
    target_id: string | null;
    metadata_json: unknown;
    created_at: string;
    actor_email: string | null;
    actor_name: string | null;
    cycle_label: string | null;
  }>(
    `SELECT a.id, a.actor_user_id, a.cycle_id, a.action_type, a.target_type, a.target_id, a.metadata_json, a.created_at,
            u.email as actor_email, (u.first_name || ' ' || u.last_name) as actor_name,
            c.cycle_label
     FROM audit_logs a
     LEFT JOIN users u ON u.id = a.actor_user_id
     LEFT JOIN scholarship_cycles c ON c.id = a.cycle_id
     ${where}
     ORDER BY a.created_at DESC
     LIMIT $${i} OFFSET $${i + 1}`,
    params
  );

  return NextResponse.json({ entries: rows });
}
