import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canManageCycle } from "@/lib/admin";
import { logAudit } from "@/lib/audit";
import { query } from "@/lib/db";
import { sanitizeRichTextHtml } from "@/lib/rich-text";
import {
  formatIntakeSchemaUnavailableMessage,
  getIntakeSchemaStatus,
} from "@/lib/intake-schema";

export const runtime = "nodejs";

/**
 * GET: Get form schema + fields for builder
 * POST: Create/Initialize form for cycle (idempotent)
 * PATCH: Update form settings
 */

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: cycleId } = await params;
  if (!await canManageCycle(user.id, user.is_platform_admin, cycleId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const intakeSchema = await getIntakeSchemaStatus();
  if (!intakeSchema.available) {
    return NextResponse.json(
      { error: formatIntakeSchemaUnavailableMessage(intakeSchema.missingTables) },
      { status: 503 }
    );
  }

  const { rows: forms } = await query<any>(
    "SELECT * FROM intake_forms WHERE cycle_id = $1",
    [cycleId]
  );
  const form = forms[0];
  if (!form) return NextResponse.json({ form: null });

  const { rows: fields } = await query<any>(
    "SELECT * FROM intake_form_fields WHERE intake_form_id = $1 ORDER BY sort_order ASC",
    [form.id]
  );

  return NextResponse.json({ form, fields });
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: cycleId } = await params;
  if (!await canManageCycle(user.id, user.is_platform_admin, cycleId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const intakeSchema = await getIntakeSchemaStatus();
  if (!intakeSchema.available) {
    return NextResponse.json(
      { error: formatIntakeSchemaUnavailableMessage(intakeSchema.missingTables) },
      { status: 503 }
    );
  }

  // Idempotent create
  const { rows: existing } = await query<{ id: string }>(
    "SELECT id FROM intake_forms WHERE cycle_id = $1",
    [cycleId]
  );
  if (existing.length > 0) return NextResponse.json({ id: existing[0].id });

  const { rows: cycleRows } = await query<{ cycle_label: string }>(
    "SELECT cycle_label FROM scholarship_cycles WHERE id = $1",
    [cycleId]
  );

  const { rows: newForm } = await query<{ id: string }>(
    "INSERT INTO intake_forms (cycle_id, title, status) VALUES ($1, $2, 'draft') RETURNING id",
    [cycleId, `Intake Form - ${cycleRows[0]?.cycle_label || cycleId}`]
  );

  await logAudit({
    actorUserId: user.id,
    cycleId,
    actionType: "intake.form_created",
    targetType: "intake_form",
    targetId: newForm[0].id,
  });

  return NextResponse.json({ id: newForm[0].id });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: cycleId } = await params;
  if (!await canManageCycle(user.id, user.is_platform_admin, cycleId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const intakeSchema = await getIntakeSchemaStatus();
  if (!intakeSchema.available) {
    return NextResponse.json(
      { error: formatIntakeSchemaUnavailableMessage(intakeSchema.missingTables) },
      { status: 503 }
    );
  }

  const body = await request.json();
  const { title, instructions_text, opens_at, closes_at, status } = body;
  const sanitizedInstructions = sanitizeRichTextHtml(instructions_text);

  const { rows: updated } = await query<{ id: string }>(
    `UPDATE intake_forms 
     SET title = COALESCE($1, title),
         instructions_text = COALESCE($2, instructions_text),
         opens_at = $3,
         closes_at = $4,
         status = COALESCE($5, status),
         updated_at = now()
     WHERE cycle_id = $6
     RETURNING id`,
    [title, sanitizedInstructions, opens_at, closes_at, status, cycleId]
  );

  if (updated.length === 0) {
    return NextResponse.json({ error: "Intake form not found" }, { status: 404 });
  }

  await logAudit({
    actorUserId: user.id,
    cycleId,
    actionType: "intake.form_updated",
    targetType: "intake_form",
    targetId: updated[0].id,
    metadata: { fields_updated: Object.keys(body) }
  });

  return NextResponse.json({ success: true });
}
