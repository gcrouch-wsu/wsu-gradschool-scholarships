import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canManageCycle } from "@/lib/admin";
import { query } from "@/lib/db";
import {
  formatIntakeSchemaUnavailableMessage,
  getIntakeSchemaStatus,
} from "@/lib/intake-schema";

export const runtime = "nodejs";

/**
 * GET: List submission audit records for a cycle.
 */

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: cycleId } = await params;
  if (!await canManageCycle(user.id, user.is_platform_admin, cycleId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const intakeSchema = await getIntakeSchemaStatus();
  if (!intakeSchema.available) {
    return NextResponse.json(
      { error: formatIntakeSchemaUnavailableMessage(intakeSchema.missingTables) },
      { status: 503 }
    );
  }

  const { rows: submissions } = await query<{
    submission_id: string;
    submitter_email: string | null;
    status: string;
    smartsheet_row_id: number | null;
    created_at: string;
    version_number: number | null;
    is_resolved: boolean;
  }>(
    `SELECT
        s.submission_id,
        s.submitter_email,
        s.status,
        s.smartsheet_row_id,
        s.created_at,
        v.version_number,
        COALESCE((s.failure_json ->> 'resolvedAt') IS NOT NULL, false) AS is_resolved
     FROM intake_submissions s
     LEFT JOIN intake_form_versions v ON v.id = s.intake_form_version_id
     WHERE s.cycle_id = $1
     ORDER BY s.created_at DESC`,
    [cycleId]
  );

  return NextResponse.json({ submissions });
}
