import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canManageCycle } from "@/lib/admin";
import { query } from "@/lib/db";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: cycleId } = await params;
  const canManage = await canManageCycle(user.id, user.is_platform_admin, cycleId);
  if (!canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const blindReview = body.blindReview;

  if (typeof blindReview !== "boolean") {
    return NextResponse.json(
      { error: "blindReview must be a boolean" },
      { status: 400 }
    );
  }

  const { rows: vc } = await query<{ id: string; settings_json: unknown }>(
    "SELECT id, settings_json FROM view_configs WHERE cycle_id = $1 LIMIT 1",
    [cycleId]
  );

  if (vc.length === 0) {
    return NextResponse.json(
      { error: "No view config found. Configure fields first." },
      { status: 400 }
    );
  }

  const current = (vc[0]!.settings_json as Record<string, unknown>) ?? {};
  const updated = { ...current, blindReview };

  await query(
    "UPDATE view_configs SET settings_json = $1 WHERE id = $2",
    [JSON.stringify(updated), vc[0]!.id]
  );

  return NextResponse.json({ success: true });
}
