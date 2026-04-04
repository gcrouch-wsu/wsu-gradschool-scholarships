import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canManageCycle } from "@/lib/admin";
import { logAudit } from "@/lib/audit";
import { query } from "@/lib/db";
import {
  buildIntakeLayoutFromFields,
  createEmptyLayout,
  readLayoutJsonOrFallback,
} from "@/lib/layout";
import { sanitizeRichTextHtml } from "@/lib/rich-text";
import {
  formatIntakeSchemaUnavailableMessage,
  getIntakeSchemaStatus,
} from "@/lib/intake-schema";
import { jsonErrorFromUnknown } from "@/lib/api-route-error";

export const runtime = "nodejs";

interface IntakeFormRow {
  id: string;
  cycle_id: string;
  title: string;
  instructions_text: string | null;
  status: string;
  opens_at: string | null;
  closes_at: string | null;
  published_version_id: string | null;
  layout_json: unknown;
  created_at: string;
  updated_at: string;
}

interface IntakeFieldRow {
  id: string;
  intake_form_id: string;
  field_key: string;
  label: string;
  help_text: string | null;
  field_type: string;
  required: boolean;
  sort_order: number;
  target_column_id: number | null;
  target_column_title: string | null;
  target_column_type: string | null;
  settings_json: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  push_to_smartsheet?: boolean;
}

/**
 * GET: Get form schema + fields for builder
 * POST: Create/Initialize form for cycle (idempotent)
 * PATCH: Update form settings
 * DELETE: Delete intake form only if it has no submissions
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

  const { rows: forms } = await query<IntakeFormRow>(
    "SELECT * FROM intake_forms WHERE cycle_id = $1",
    [cycleId]
  );
  const form = forms[0];
  if (!form) return NextResponse.json({ form: null });

  const { rows: fields } = await query<IntakeFieldRow>(
    "SELECT * FROM intake_form_fields WHERE intake_form_id = $1 ORDER BY sort_order ASC",
    [form.id]
  );

  return NextResponse.json({
    form: {
      ...form,
      layout_json: readLayoutJsonOrFallback(
        form.layout_json,
        buildIntakeLayoutFromFields(fields),
        {
          knownFieldKeys: fields.map((field) => field.field_key),
          requireAllPlaced: false,
          allowedSectionKeys: ["main"],
        }
      ),
    },
    fields,
  });
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
    "INSERT INTO intake_forms (cycle_id, title, status, layout_json) VALUES ($1, $2, 'draft', $3) RETURNING id",
    [
      cycleId,
      `Intake Form - ${cycleRows[0]?.cycle_label || cycleId}`,
      JSON.stringify(createEmptyLayout()),
    ]
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
  try {
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

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Expected a JSON object" }, { status: 400 });
    }

    const title = body.title as string | undefined;
    const instructions_text = body.instructions_text as string | null | undefined;
    const opens_at = body.opens_at as string | null | undefined;
    const closes_at = body.closes_at as string | null | undefined;
    const status = body.status as string | undefined;
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
      metadata: { fields_updated: Object.keys(body) },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    return jsonErrorFromUnknown(err, "PATCH /api/admin/cycles/[id]/intake-form");
  }
}

export async function DELETE(
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

  const { rows: forms } = await query<{ id: string }>(
    "SELECT id FROM intake_forms WHERE cycle_id = $1",
    [cycleId]
  );
  const form = forms[0];
  if (!form) {
    return NextResponse.json({ error: "Intake form not found" }, { status: 404 });
  }

  const { rows: counts } = await query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM intake_submissions WHERE intake_form_id = $1",
    [form.id]
  );
  const submissionCount = Number(counts[0]?.count ?? "0");
  if (submissionCount > 0) {
    return NextResponse.json(
      {
        error:
          "This intake form already has submission history and cannot be deleted. Unpublish it instead if you need to take it offline.",
      },
      { status: 409 }
    );
  }

  await query("DELETE FROM intake_forms WHERE id = $1", [form.id]);

  await logAudit({
    actorUserId: user.id,
    cycleId,
    actionType: "intake.form_deleted",
    targetType: "intake_form",
    targetId: form.id,
  });

  return NextResponse.json({ success: true });
}
