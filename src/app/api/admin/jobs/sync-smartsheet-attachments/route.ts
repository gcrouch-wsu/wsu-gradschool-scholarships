import { NextRequest, NextResponse } from "next/server";
import { getIntakeSchemaStatus } from "@/lib/intake-schema";
import { runAttachmentSyncBatch } from "@/lib/attachment-sync";

export const runtime = "nodejs";
/** Vercel Pro+: raise if your plan allows (Hobby max is lower). */
export const maxDuration = 60;

/**
 * GET: Process pending intake → Smartsheet attachment sync jobs (cron + manual with CRON_SECRET).
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const intakeSchema = await getIntakeSchemaStatus();
  if (!intakeSchema.available) {
    return NextResponse.json({
      processed: 0,
      errors: 0,
      staleReset: 0,
      skipped: true,
      reason: "intake schema unavailable",
    });
  }

  const result = await runAttachmentSyncBatch();
  return NextResponse.json(result);
}
