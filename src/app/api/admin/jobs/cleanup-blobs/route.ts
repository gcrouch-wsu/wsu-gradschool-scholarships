import { NextRequest, NextResponse } from "next/server";
import { list, del } from "@vercel/blob";
import { query } from "@/lib/db";
import { getIntakeSchemaStatus } from "@/lib/intake-schema";

export const runtime = "nodejs";

/**
 * GET: Cleanup orphaned blobs in the intake/ directory.
 * Blobs that don't have a record in intake_submission_files and are > 24h old.
 */

export async function GET(request: NextRequest) {
  // Simple token check or cron check
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const intakeSchema = await getIntakeSchemaStatus();
  if (!intakeSchema.available) {
    return NextResponse.json({
      processed: 0,
      deleted: 0,
      pathnames: [],
      skipped: true,
      reason: "intake schema unavailable",
    });
  }

  const { blobs } = await list({ prefix: "intake/", token: process.env.BLOB_READ_WRITE_TOKEN });

  const now = new Date();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const orphaned: string[] = [];

  for (const blob of blobs) {
    if (new Date(blob.uploadedAt) > twentyFourHoursAgo) continue;

    const { rows } = await query(
      "SELECT id FROM intake_submission_files WHERE blob_pathname = $1",
      [blob.pathname]
    );

    if (rows.length === 0) {
      orphaned.push(blob.pathname);
    }
  }

  const mirroredDelete: string[] = [];
  if (intakeSchema.available) {
    const { rows: ready } = await query<{ id: string; blob_pathname: string }>(
      `SELECT id, blob_pathname FROM intake_submission_files
       WHERE attachment_sync_status = 'synced'
         AND smartsheet_attachment_id IS NOT NULL
         AND blob_delete_after IS NOT NULL
         AND blob_delete_after <= now()
         AND blob_deleted_at IS NULL`
    );
    for (const row of ready) {
      mirroredDelete.push(row.blob_pathname);
    }
  }

  const toDelete = [...new Set([...orphaned, ...mirroredDelete])];

  if (toDelete.length > 0) {
    await del(toDelete, { token: process.env.BLOB_READ_WRITE_TOKEN });
  }

  if (intakeSchema.available && mirroredDelete.length > 0) {
    await query(
      `UPDATE intake_submission_files
       SET attachment_sync_status = 'deleted_from_blob', blob_deleted_at = now()
       WHERE blob_pathname = ANY($1::text[])`,
      [mirroredDelete]
    );
  }

  return NextResponse.json({
    processed: blobs.length,
    deleted: toDelete.length,
    pathnames: toDelete,
    mirroredStagedDeletes: mirroredDelete.length,
  });
}
