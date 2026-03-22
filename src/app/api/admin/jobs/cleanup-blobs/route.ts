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
    
    // Check if exists in DB
    const { rows } = await query(
      "SELECT id FROM intake_submission_files WHERE blob_pathname = $1",
      [blob.pathname]
    );
    
    if (rows.length === 0) {
      orphaned.push(blob.pathname);
    }
  }
  
  if (orphaned.length > 0) {
    await del(orphaned, { token: process.env.BLOB_READ_WRITE_TOKEN });
  }

  return NextResponse.json({ 
    processed: blobs.length,
    deleted: orphaned.length,
    pathnames: orphaned
  });
}
