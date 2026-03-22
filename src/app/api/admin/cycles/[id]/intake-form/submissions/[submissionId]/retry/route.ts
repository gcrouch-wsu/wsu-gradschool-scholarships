import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canManageCycle } from "@/lib/admin";
import { query } from "@/lib/db";
import { processSubmission } from "@/lib/intake";
import {
  formatIntakeSchemaUnavailableMessage,
  getIntakeSchemaStatus,
} from "@/lib/intake-schema";

export const runtime = "nodejs";

/**
 * POST: Retry a failed submission.
 */

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
  const intakeSchema = await getIntakeSchemaStatus();
  if (!intakeSchema.available) {
    return NextResponse.json(
      { error: formatIntakeSchemaUnavailableMessage(intakeSchema.missingTables) },
      { status: 503 }
    );
  }

  const { rows } = await query<any>(
    "SELECT * FROM intake_submissions WHERE submission_id = $1 AND cycle_id = $2",
    [submissionId, cycleId]
  );
  const submission = rows[0];
  if (!submission) {
    return NextResponse.json({ error: "Submission not found" }, { status: 404 });
  }

  try {
    const result = await processSubmission({
      cycleId,
      submissionId,
      formVersionId: submission.intake_form_version_id,
      submitterEmail: submission.submitter_email,
      fields: submission.request_cells_json,
      files: submission.request_files_json,
      ip: "0.0.0.0" // Not relevant for admin retry
    });

    if (result.success) {
      return NextResponse.json({ success: true, rowId: result.rowId });
    } else {
      return NextResponse.json({ error: result.error }, { status: result.status || 500 });
    }
  } catch (err) {
    console.error("Retry failed:", err);
    return NextResponse.json({ error: "Retry failed" }, { status: 500 });
  }
}
