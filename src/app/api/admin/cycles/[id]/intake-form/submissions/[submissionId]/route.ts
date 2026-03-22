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
 * DELETE: Delete a submission record.
 */

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; submissionId: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: cycleId, submissionId } = await params;
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

  await query(
    "DELETE FROM intake_submissions WHERE submission_id = $1 AND cycle_id = $2",
    [submissionId, cycleId]
  );

  return NextResponse.json({ success: true });
}
