import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canManageCycle } from "@/lib/admin";
import { query } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; submissionId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: cycleId, submissionId } = await params;
  if (!await canManageCycle(user.id, user.is_platform_admin, cycleId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { rowCount } = await query(
    `UPDATE intake_submissions
     SET failure_json = COALESCE(failure_json, '{}'::jsonb) || jsonb_build_object(
       'resolvedAt', now(),
       'resolvedByUserId', $3
     ),
         updated_at = now()
     WHERE submission_id = $1 AND cycle_id = $2`,
    [submissionId, cycleId, user.id]
  );

  if (rowCount === 0) {
    return NextResponse.json({ error: "Submission not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
