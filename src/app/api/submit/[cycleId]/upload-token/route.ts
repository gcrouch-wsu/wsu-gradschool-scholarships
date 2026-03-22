import { NextRequest, NextResponse } from "next/server";
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client";
import { query } from "@/lib/db";
import { buildBlobPathname, checkRateLimit, MAX_INTAKE_FILE_SIZE_BYTES } from "@/lib/intake";

export const runtime = "nodejs";

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (!forwarded) return "127.0.0.1";
  return forwarded.split(",")[0]?.trim() || "127.0.0.1";
}

/**
 * POST: Authorize direct browser upload to private Blob.
 */

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ cycleId: string }> }
) {
  const { cycleId } = await params;
  const ip = getClientIp(request);

  // 14.1 Public abuse controls: Rate limiting
  const rl = await checkRateLimit(cycleId, ip, "upload-token");
  if (!rl.ok) {
    return NextResponse.json({ error: rl.error }, { status: 429 });
  }

  const body = await request.json();
  const { submissionId, fieldKey, filename, contentType, sizeBytes, honeypot } = body;

  // Validation
  if (!submissionId || !fieldKey || !filename || !contentType || !sizeBytes) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (typeof honeypot === "string" && honeypot.trim() !== "") {
    return NextResponse.json({ error: "Upload rejected" }, { status: 400 });
  }

  // Get intake form and its published version
  const { rows } = await query<any>(
    `SELECT f.id, f.opens_at, f.closes_at, f.status as form_status,
            v.snapshot_json
     FROM intake_forms f
     JOIN intake_form_versions v ON v.id = f.published_version_id
     WHERE f.cycle_id = $1 AND f.status = 'published'`,
    [cycleId]
  );

  const form = rows[0];
  if (!form) {
    return NextResponse.json({ error: "No intake form published" }, { status: 404 });
  }

  // Window enforcement
  const now = new Date();
  if (form.opens_at && now < new Date(form.opens_at)) {
    return NextResponse.json({ error: "Form is not yet open" }, { status: 403 });
  }
  if (form.closes_at && now > new Date(form.closes_at)) {
    return NextResponse.json({ error: "Form is closed" }, { status: 403 });
  }

  // Field verification
  const snapshot = form.snapshot_json;
  const field = snapshot.fields.find((f: any) => f.field_key === fieldKey);
  if (!field || field.field_type !== "file") {
    return NextResponse.json({ error: "Invalid file field" }, { status: 400 });
  }

  // Limits
  if (contentType !== "application/pdf") {
    return NextResponse.json({ error: "Only PDF files are allowed" }, { status: 400 });
  }
  if (sizeBytes > MAX_INTAKE_FILE_SIZE_BYTES) {
    return NextResponse.json({ error: "File size exceeds 100MB limit" }, { status: 400 });
  }

  // Generate token
  // 8.2: canonical upload pathname prefix
  const pathname = buildBlobPathname(cycleId, submissionId, fieldKey, filename);

  try {
    const token = await generateClientTokenFromReadWriteToken({
      token: process.env.BLOB_READ_WRITE_TOKEN,
      pathname,
      maximumSizeInBytes: MAX_INTAKE_FILE_SIZE_BYTES,
      allowedContentTypes: ["application/pdf"],
      validUntil: Date.now() + 5 * 60 * 1000,
      addRandomSuffix: false,
      allowOverwrite: false,
    });

    return NextResponse.json({
      token,
      pathname,
    });
  } catch (err) {
    console.error("Failed to generate blob token:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
