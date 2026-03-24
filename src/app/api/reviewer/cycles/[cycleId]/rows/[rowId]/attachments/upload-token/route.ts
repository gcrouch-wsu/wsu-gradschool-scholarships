import { NextRequest, NextResponse } from "next/server";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { getSessionUser } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  buildReviewerAttachmentBlobPath,
  formatReviewerAttachmentSchemaUnavailableMessage,
  getReviewerAttachmentSchemaStatus,
  MAX_REVIEWER_ATTACHMENT_SIZE_BYTES,
} from "@/lib/reviewer-attachments";
import { getEffectiveReviewerConfig } from "@/lib/reviewer-config";
import {
  getReviewerRoleFields,
  getVisibleReviewerRoleFields,
  isReviewerAttachmentField,
} from "@/lib/reviewer-field-access";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ cycleId: string; rowId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { cycleId, rowId } = await params;
  const rowIdNum = parseInt(rowId, 10);
  if (isNaN(rowIdNum)) {
    return NextResponse.json({ error: "Invalid row ID" }, { status: 400 });
  }

  const schema = await getReviewerAttachmentSchemaStatus();
  if (!schema.available) {
    return NextResponse.json(
      { error: formatReviewerAttachmentSchemaUnavailableMessage() },
      { status: 503 }
    );
  }

  const { rows: membership } = await query<{ role_id: string }>(
    `SELECT role_id FROM scholarship_memberships m
     JOIN scholarship_cycles c ON c.id = m.cycle_id
     WHERE m.user_id = $1 AND m.cycle_id = $2 AND m.status = 'active' AND c.status = 'active'`,
    [user.id, cycleId]
  );
  if (membership.length === 0) {
    return NextResponse.json({ error: "Not assigned to this cycle" }, { status: 403 });
  }

  const effectiveConfig = await getEffectiveReviewerConfig(cycleId);
  const visibleRoleFieldConfigs = getVisibleReviewerRoleFields(
    getReviewerRoleFields(
      effectiveConfig.fieldConfigs,
      effectiveConfig.permissions,
      membership[0]!.role_id,
      effectiveConfig.viewConfig?.settings_json
    )
  );
  const canEditAttachments = visibleRoleFieldConfigs.some(
    (fieldConfig) => isReviewerAttachmentField(fieldConfig) && fieldConfig.can_edit
  );
  if (!canEditAttachments) {
    return NextResponse.json(
      { error: "Your role cannot add attachments for this cycle" },
      { status: 403 }
    );
  }

  const body = await request.json();
  const { filename, contentType, sizeBytes, uploadId } = body ?? {};
  if (
    typeof filename !== "string" ||
    typeof uploadId !== "string" ||
    typeof sizeBytes !== "number"
  ) {
    return NextResponse.json({ error: "Missing required file metadata" }, { status: 400 });
  }
  if (sizeBytes > MAX_REVIEWER_ATTACHMENT_SIZE_BYTES) {
    return NextResponse.json({ error: "Attachment exceeds the 50 MB limit" }, { status: 400 });
  }

  const pathname = buildReviewerAttachmentBlobPath(
    cycleId,
    rowIdNum,
    user.id,
    filename,
    uploadId
  );

  try {
    const token = await generateClientTokenFromReadWriteToken({
      token: process.env.BLOB_READ_WRITE_TOKEN,
      pathname,
      maximumSizeInBytes: MAX_REVIEWER_ATTACHMENT_SIZE_BYTES,
      validUntil: Date.now() + 5 * 60 * 1000,
      addRandomSuffix: false,
      allowOverwrite: false,
      ...(typeof contentType === "string" && contentType
        ? { allowedContentTypes: [contentType] }
        : {}),
    });

    return NextResponse.json({
      token,
      pathname,
    });
  } catch (err) {
    console.error("Failed to generate reviewer attachment upload token:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
