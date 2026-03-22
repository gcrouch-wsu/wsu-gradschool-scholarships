import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { query } from "@/lib/db";
import { checkRateLimit } from "@/lib/intake";
import {
  formatIntakeSchemaUnavailableMessage,
  getIntakeSchemaStatus,
} from "@/lib/intake-schema";

export const runtime = "nodejs";

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (!forwarded) return "127.0.0.1";
  return forwarded.split(",")[0]?.trim() || "127.0.0.1";
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ cycleId: string }> }
) {
  const { cycleId } = await params;
  const intakeSchema = await getIntakeSchemaStatus();
  if (!intakeSchema.available) {
    return NextResponse.json(
      { error: formatIntakeSchemaUnavailableMessage(intakeSchema.missingTables) },
      { status: 503 }
    );
  }

  const ip = getClientIp(request);
  const rl = await checkRateLimit(cycleId, ip, "upload-token");
  if (!rl.ok) {
    return NextResponse.json({ error: rl.error }, { status: 429 });
  }

  const body = await request.json();
  const { submissionId, fieldKey, blobPathname, honeypot } = body ?? {};

  if (!submissionId || !fieldKey || !blobPathname) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (typeof honeypot === "string" && honeypot.trim() !== "") {
    return NextResponse.json({ error: "Delete rejected" }, { status: 400 });
  }

  const expectedPrefix = `intake/${cycleId}/${submissionId}/${fieldKey}/`;
  if (typeof blobPathname !== "string" || !blobPathname.startsWith(expectedPrefix)) {
    return NextResponse.json({ error: "Invalid blob pathname" }, { status: 400 });
  }

  const { rows } = await query<any>(
    `SELECT v.snapshot_json
     FROM intake_forms f
     JOIN intake_form_versions v ON v.id = f.published_version_id
     WHERE f.cycle_id = $1 AND f.status = 'published'`,
    [cycleId]
  );
  const snapshot = rows[0]?.snapshot_json;
  const field = snapshot?.fields?.find((candidate: any) => candidate.field_key === fieldKey);
  if (!field || field.field_type !== "file") {
    return NextResponse.json({ error: "Invalid file field" }, { status: 400 });
  }

  await del(blobPathname, { token: process.env.BLOB_READ_WRITE_TOKEN });

  return NextResponse.json({ success: true });
}
