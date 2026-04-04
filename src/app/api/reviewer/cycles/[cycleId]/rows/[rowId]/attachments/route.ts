import { NextRequest, NextResponse } from "next/server";
import { head } from "@vercel/blob";
import { getSessionUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { query } from "@/lib/db";
import { getReviewerRowContext } from "@/lib/reviewer";
import { getIntakeSchemaStatus } from "@/lib/intake-schema";
import { mergeIntakeWithSmartsheetAttachments } from "@/lib/intake-attachment-merge";
import {
  buildReviewerAttachmentBlobPath,
  createSignedReviewerFileUrl,
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
import { getRowAttachments } from "@/lib/smartsheet";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
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

  const ctx = await getReviewerRowContext(user.id, cycleId, rowIdNum);
  if (!ctx) {
    return NextResponse.json(
      { error: "Row not found or access denied" },
      { status: 404 }
    );
  }

  const effectiveConfig = await getEffectiveReviewerConfig(cycleId);
  const visibleRoleFieldConfigs = getVisibleReviewerRoleFields(
    getReviewerRoleFields(
      effectiveConfig.fieldConfigs,
      effectiveConfig.permissions,
      ctx.roleId,
      effectiveConfig.viewConfig?.settings_json
    )
  );
  const canViewAttachments = visibleRoleFieldConfigs.some(isReviewerAttachmentField);
  if (!canViewAttachments) {
    return NextResponse.json(
      { error: "Your role does not have permission to view attachments" },
      { status: 403 }
    );
  }

  const result = await getRowAttachments(ctx.token, ctx.sheetId, rowIdNum);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error ?? "Failed to fetch attachments" },
      { status: 500 }
    );
  }

  // 11.3 Attachment visibility: Merge Smartsheet and intake-upload files
  const intakeSchema = await getIntakeSchemaStatus();
  const intakeFiles = intakeSchema.available
    ? (
        await query<{
          id: string;
          original_filename: string;
          attachment_sync_status: string;
          smartsheet_attachment_id: string | number | null;
        }>(
          `SELECT id, original_filename, attachment_sync_status, smartsheet_attachment_id
           FROM intake_submission_files WHERE cycle_id = $1 AND smartsheet_row_id = $2`,
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

  const mergedIntake = mergeIntakeWithSmartsheetAttachments(result.attachments ?? [], intakeFiles);

  const merged = [
    ...mergedIntake,
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

  const ctx = await getReviewerRowContext(user.id, cycleId, rowIdNum);
  if (!ctx) {
    return NextResponse.json(
      { error: "Row not found or access denied" },
      { status: 404 }
    );
  }

  const effectiveConfig = await getEffectiveReviewerConfig(cycleId);
  const visibleRoleFieldConfigs = getVisibleReviewerRoleFields(
    getReviewerRoleFields(
      effectiveConfig.fieldConfigs,
      effectiveConfig.permissions,
      ctx.roleId,
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
  const {
    uploadId,
    blobPathname,
    originalFilename,
    contentType,
    sizeBytes,
  } = body ?? {};

  if (
    typeof uploadId !== "string" ||
    typeof blobPathname !== "string" ||
    typeof originalFilename !== "string" ||
    typeof contentType !== "string" ||
    typeof sizeBytes !== "number"
  ) {
    return NextResponse.json({ error: "Missing required file metadata" }, { status: 400 });
  }

  if (sizeBytes > MAX_REVIEWER_ATTACHMENT_SIZE_BYTES) {
    return NextResponse.json({ error: "Attachment exceeds the 50 MB limit" }, { status: 400 });
  }

  const expectedPathname = buildReviewerAttachmentBlobPath(
    cycleId,
    rowIdNum,
    user.id,
    originalFilename,
    uploadId
  );
  if (blobPathname !== expectedPathname) {
    return NextResponse.json({ error: "Attachment path verification failed" }, { status: 400 });
  }

  let blobMeta;
  try {
    blobMeta = await head(blobPathname, {
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
  } catch {
    return NextResponse.json({ error: "Attachment could not be verified in Blob storage" }, { status: 400 });
  }

  if (blobMeta.pathname !== expectedPathname) {
    return NextResponse.json({ error: "Attachment pathname mismatch" }, { status: 400 });
  }
  if (blobMeta.size > MAX_REVIEWER_ATTACHMENT_SIZE_BYTES) {
    return NextResponse.json({ error: "Attachment exceeds the 50 MB limit" }, { status: 400 });
  }

  const { rows } = await query<{
    id: string;
    original_filename: string;
    content_type: string;
  }>(
    `INSERT INTO reviewer_row_files (
       cycle_id,
       smartsheet_row_id,
       uploaded_by_user_id,
       blob_url,
       blob_pathname,
       original_filename,
       content_type,
       size_bytes
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (blob_pathname) DO UPDATE
       SET blob_url = EXCLUDED.blob_url
     RETURNING id, original_filename, content_type`,
    [
      cycleId,
      rowIdNum,
      user.id,
      blobMeta.url,
      blobMeta.pathname,
      originalFilename,
      blobMeta.contentType || contentType || "application/octet-stream",
      blobMeta.size,
    ]
  );
  const saved = rows[0];

  await logAudit({
    actorUserId: user.id,
    cycleId,
    actionType: "reviewer.attachment_uploaded",
    targetType: "row",
    targetId: String(rowIdNum),
    metadata: {
      rowId: rowIdNum,
      filename: saved?.original_filename ?? originalFilename,
      source: "reviewer_upload",
    },
  });

  return NextResponse.json({
    success: true,
    attachment: {
      id: saved?.id,
      name: saved?.original_filename ?? originalFilename,
      url: saved?.id ? createSignedReviewerFileUrl(saved.id) : undefined,
      source: "reviewer_upload",
      mimeType: saved?.content_type ?? blobMeta.contentType ?? contentType,
    },
  });
}
