import { NextRequest, NextResponse } from "next/server";
import { head } from "@vercel/blob";
import { getSessionUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { query } from "@/lib/db";
import { decrypt } from "@/lib/encryption";
import { createSignedIntakeFileUrl } from "@/lib/intake";
import { getIntakeSchemaStatus } from "@/lib/intake-schema";
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
  const canViewAttachments = visibleRoleFieldConfigs.some(isReviewerAttachmentField);
  if (!canViewAttachments) {
    return NextResponse.json(
      { error: "Your role does not have permission to view attachments" },
      { status: 403 }
    );
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

  // 11.3 Attachment visibility: Merge Smartsheet and intake-upload files
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
