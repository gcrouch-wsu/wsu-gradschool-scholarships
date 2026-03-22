import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { checkRateLimit, processSubmission } from "@/lib/intake";
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

/**
 * GET: Return the currently published form definition and availability status.
 */
export async function GET(
  _request: NextRequest,
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

  // Get intake form and its published version
  const { rows } = await query<any>(
    `SELECT f.title, f.instructions_text, f.opens_at, f.closes_at, f.status as form_status,
            v.id as version_id, v.snapshot_json
     FROM intake_forms f
     JOIN intake_form_versions v ON v.id = f.published_version_id
     WHERE f.cycle_id = $1 AND f.status = 'published'`,
    [cycleId]
  );

  const form = rows[0];
  if (!form) {
    return NextResponse.json({ error: "No intake form published for this cycle" }, { status: 404 });
  }

  const now = new Date();
  let status: "open" | "scheduled" | "closed" = "open";

  if (form.opens_at && now < new Date(form.opens_at)) {
    status = "scheduled";
  } else if (form.closes_at && now > new Date(form.closes_at)) {
    status = "closed";
  }

  const snapshot = form.snapshot_json;

  return NextResponse.json({
    cycleId,
    formVersionId: form.version_id,
    title: snapshot.title,
    instructionsText: snapshot.instructions_text,
    opensAt: snapshot.opens_at,
    closesAt: snapshot.closes_at,
    status,
    fields: snapshot.fields.sort((a: any, b: any) => a.sort_order - b.sort_order),
    fileLimits: {
      maxSizeBytes: 104857600, // 100 MB
      allowedContentTypes: ["application/pdf"]
    }
  });
}

/**
 * POST: Accept submission metadata, create row, and link files.
 */
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

  // 14.1 Public abuse controls: Rate limiting
  const rl = await checkRateLimit(cycleId, ip, "submit");
  if (!rl.ok) {
    return NextResponse.json({ error: rl.error }, { status: 429 });
  }

  const body = await request.json();
  const { submissionId, formVersionId, submitterEmail, honeypot, fields, files } = body;

  // Validation
  if (!submissionId || !formVersionId || !submitterEmail || !fields) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  if (typeof honeypot === "string" && honeypot.trim() !== "") {
    return NextResponse.json({ error: "Submission rejected" }, { status: 400 });
  }

  // 8.3: submitterEmail must end with @wsu.edu
  if (!submitterEmail.toLowerCase().endsWith("@wsu.edu")) {
    return NextResponse.json({ error: "Only @wsu.edu emails are allowed" }, { status: 400 });
  }

  // Get intake form and its published version
  const { rows } = await query<any>(
    `SELECT f.id, f.opens_at, f.closes_at, f.status as form_status,
            v.id as version_id, v.snapshot_json
     FROM intake_forms f
     JOIN intake_form_versions v ON v.id = f.published_version_id
     WHERE f.cycle_id = $1 AND f.status = 'published'`,
    [cycleId]
  );

  const form = rows[0];
  if (!form) {
    return NextResponse.json({ error: "No intake form published" }, { status: 404 });
  }

  // 8.3: formVersionId must match the currently published version
  if (formVersionId !== form.version_id) {
    return NextResponse.json({ error: "The form has been updated. Please refresh and try again." }, { status: 409 });
  }

  // Window enforcement
  const now = new Date();
  if (form.opens_at && now < new Date(form.opens_at)) {
    return NextResponse.json({ error: "Form is not yet open" }, { status: 403 });
  }
  if (form.closes_at && now > new Date(form.closes_at)) {
    return NextResponse.json({ error: "Form is closed" }, { status: 403 });
  }

  try {
    const result = await processSubmission({
      cycleId,
      submissionId,
      formVersionId,
      submitterEmail,
      fields,
      files: files || [],
      ip
    });

    if (result.success) {
      return NextResponse.json({
        success: true,
        submissionId,
        rowId: result.rowId,
        message: "Nomination submitted successfully",
      }, { status: result.status || 201 });
    } else {
      return NextResponse.json({ error: result.error }, { status: result.status || 500 });
    }
  } catch (err) {
    console.error("Submission processing failed:", err);
    const msg = err instanceof Error ? err.message : "Internal processing error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
