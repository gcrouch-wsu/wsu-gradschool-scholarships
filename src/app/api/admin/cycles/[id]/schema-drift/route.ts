import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canManageCycle } from "@/lib/admin";
import { getLiveColumnIds } from "@/lib/reviewer";
import { query } from "@/lib/db";

/**
 * Returns schema drift: mapped columns that no longer exist in the live Smartsheet sheet.
 */
export async function GET(
  _request: Request,
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

  const liveColumnIds = await getLiveColumnIds(cycleId);
  if (!liveColumnIds) {
    return NextResponse.json({
      ok: false,
      error: "Could not fetch live schema",
      driftedColumns: [],
    });
  }

  const { rows: fieldConfigs } = await query<{
    field_key: string;
    source_column_id: number;
    source_column_title: string;
    display_label: string;
  }>(
    "SELECT field_key, source_column_id, source_column_title, display_label FROM field_configs WHERE cycle_id = $1",
    [cycleId]
  );

  const driftedColumns = fieldConfigs.filter(
    (f) => f.source_column_id !== 0 && !liveColumnIds.has(f.source_column_id)
  );

  return NextResponse.json({
    ok: true,
    driftedColumns: driftedColumns.map((c) => ({
      fieldKey: c.field_key,
      columnId: c.source_column_id,
      columnTitle: c.source_column_title,
      displayLabel: c.display_label,
    })),
  });
}
