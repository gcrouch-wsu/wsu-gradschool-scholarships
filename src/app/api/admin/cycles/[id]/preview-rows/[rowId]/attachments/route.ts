import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canManageCycle } from "@/lib/admin";
import { query } from "@/lib/db";
import { decrypt } from "@/lib/encryption";
import { createSignedIntakeFileUrl } from "@/lib/intake";
import { getIntakeSchemaStatus } from "@/lib/intake-schema";
import { getEffectiveReviewerConfig } from "@/lib/reviewer-config";
import {
  createSignedReviewerFileUrl,
  getReviewerAttachmentSchemaStatus,
} from "@/lib/reviewer-attachments";
import {
  getReviewerRoleFields,
  getVisibleReviewerRoleFields,
  isReviewerAttachmentField,
} from "@/lib/reviewer-field-access";
import { getRowAttachments } from "@/lib/smartsheet";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; rowId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: cycleId, rowId } = await params;
  const rowIdNum = parseInt(rowId, 10);
  if (isNaN(rowIdNum)) {
    return NextResponse.json({ error: "Invalid row ID" }, { status: 400 });
  }

  const canManage = await canManageCycle(user.id, user.is_platform_admin, cycleId);
  if (!canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const requestedRoleId = new URL(request.url).searchParams.get("roleId");
  const { rows: roles } = await query<{ id: string }>(
    "SELECT id FROM roles WHERE cycle_id = $1 ORDER BY sort_order",
    [cycleId]
  );
  const roleId =
    requestedRoleId && roles.some((role) => role.id === requestedRoleId)
      ? requestedRoleId
      : roles[0]?.id;
  if (!roleId) {
    return NextResponse.json({ error: "No roles configured" }, { status: 400 });
  }

  const effectiveConfig = await getEffectiveReviewerConfig(cycleId);
  const visibleRoleFieldConfigs = getVisibleReviewerRoleFields(
    getReviewerRoleFields(
      effectiveConfig.fieldConfigs,
      effectiveConfig.permissions,
      roleId,
      effectiveConfig.viewConfig?.settings_json
    )
  );
  const canViewAttachments = visibleRoleFieldConfigs.some(isReviewerAttachmentField);
  if (!canViewAttachments) {
    return NextResponse.json({ attachments: [] });
  }

  const { rows: cycles } = await query<{
    connection_id: string;
    sheet_id: number;
  }>(
    "SELECT connection_id, sheet_id FROM scholarship_cycles WHERE id = $1",
    [cycleId]
  );
  const cycle = cycles[0];
  if (!cycle?.connection_id || !cycle.sheet_id) {
    return NextResponse.json(
      { error: "Cycle has no sheet configured" },
      { status: 400 }
    );
  }

  const { rows: conn } = await query<{ encrypted_credentials: string }>(
    "SELECT encrypted_credentials FROM connections WHERE id = $1",
    [cycle.connection_id]
  );
  if (!conn[0]?.encrypted_credentials) {
    return NextResponse.json({ error: "Connection not found" }, { status: 500 });
  }

  let token: string;
  try {
    token = decrypt(conn[0].encrypted_credentials);
  } catch {
    return NextResponse.json(
      { error: "Could not decrypt credentials" },
      { status: 500 }
    );
  }

  const result = await getRowAttachments(token, cycle.sheet_id, rowIdNum);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error ?? "Failed to fetch attachments" },
      { status: 500 }
    );
  }

  // 15.2 Admin preview: Merge Smartsheet and intake-upload files
  const intakeSchema = await getIntakeSchemaStatus();
  const intakeFiles = intakeSchema.available
    ? (
        await query<{
          id: string;
          original_filename: string;
        }>(
          "SELECT id, original_filename FROM intake_submission_files WHERE cycle_id = $1 AND smartsheet_row_id = $2",
          [cycleId, rowIdNum]
        )
      ).rows
    : [];
  const reviewerAttachmentSchema = await getReviewerAttachmentSchemaStatus();
  const reviewerFiles = reviewerAttachmentSchema.available
    ? (
        await query<{
          id: string;
          original_filename: string;
          content_type: string;
        }>(
          "SELECT id, original_filename, content_type FROM reviewer_row_files WHERE cycle_id = $1 AND smartsheet_row_id = $2 ORDER BY created_at ASC",
          [cycleId, rowIdNum]
        )
      ).rows
    : [];

  const merged = [
    ...(result.attachments ?? []).map((a) => ({
      id: String(a.id),
      name: a.name,
      url: a.url,
      source: "smartsheet" as const,
      mimeType: a.mimeType,
    })),
    ...intakeFiles.map((f) => ({
      id: f.id,
      name: f.original_filename,
      url: createSignedIntakeFileUrl(f.id),
      source: "intake_upload" as const,
      mimeType: "application/pdf",
    })),
    ...reviewerFiles.map((f) => ({
      id: f.id,
      name: f.original_filename,
      url: createSignedReviewerFileUrl(f.id),
      source: "reviewer_upload" as const,
      mimeType: f.content_type,
    })),
  ];

  return NextResponse.json({
    attachments: merged,
  });
}
