import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canManageCycle } from "@/lib/admin";
import { logAudit } from "@/lib/audit";
import { query, withTransaction } from "@/lib/db";
import {
  INTAKE_ALLOWED_COLUMN_TYPES,
  INTAKE_ALLOWED_FIELD_TYPES,
} from "@/lib/intake";
import {
  formatIntakeSchemaUnavailableMessage,
  getIntakeSchemaStatus,
} from "@/lib/intake-schema";

export const runtime = "nodejs";

/**
 * PUT: Replace all fields (Bulk Save)
 */

export async function PUT(
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

  const { rows: forms } = await query<{ id: string }>(
    "SELECT id FROM intake_forms WHERE cycle_id = $1",
    [cycleId]
  );
  const form = forms[0];
  if (!form) return NextResponse.json({ error: "Intake form not found" }, { status: 404 });

  const body = await request.json();
  const { fields } = body;

  if (!Array.isArray(fields)) {
    return NextResponse.json({ error: "fields must be an array" }, { status: 400 });
  }

  // Validate fields against the locked v1 builder rules.
  const keys = new Set<string>();
  const mappedColumns = new Set<string>();
  for (const f of fields) {
    if (!f.field_key || !f.label || !f.field_type) {
      return NextResponse.json({ error: "field_key, label, and field_type are required" }, { status: 400 });
    }
    if (keys.has(f.field_key)) {
      return NextResponse.json({ error: `Duplicate field key: ${f.field_key}` }, { status: 400 });
    }
    if (!(INTAKE_ALLOWED_FIELD_TYPES as readonly string[]).includes(f.field_type)) {
      return NextResponse.json({ error: `Unsupported field type: ${f.field_type}` }, { status: 400 });
    }
    if (typeof f.label !== "string" || f.label.trim() === "") {
      return NextResponse.json({ error: `Field "${f.field_key}" is missing a label` }, { status: 400 });
    }

    if (f.field_type === "file") {
      if (f.target_column_id || f.target_column_title || f.target_column_type) {
        return NextResponse.json({ error: `File field "${f.label}" cannot map directly to a Smartsheet column` }, { status: 400 });
      }
      if (f.settings_json?.multiple !== undefined && typeof f.settings_json.multiple !== "boolean") {
        return NextResponse.json({ error: `File field "${f.label}" has an invalid multiple-files setting` }, { status: 400 });
      }
    } else {
      if (!f.target_column_id || !f.target_column_title || !f.target_column_type) {
        return NextResponse.json({ error: `Field "${f.label}" is missing a target column mapping` }, { status: 400 });
      }
      if (!(INTAKE_ALLOWED_COLUMN_TYPES as readonly string[]).includes(f.target_column_type)) {
        return NextResponse.json({ error: `Field "${f.label}" maps to unsupported column type ${f.target_column_type}` }, { status: 400 });
      }
      const mappedColumnKey = String(f.target_column_id);
      if (mappedColumns.has(mappedColumnKey)) {
        return NextResponse.json({ error: `Mapped column "${f.target_column_title}" is already used by another field` }, { status: 400 });
      }
      mappedColumns.add(mappedColumnKey);
    }

    if (f.field_type === "select") {
      const options = Array.isArray(f.settings_json?.options)
        ? f.settings_json.options.filter((option: unknown): option is string => typeof option === "string" && option.trim() !== "")
        : [];
      if (options.length === 0) {
        return NextResponse.json({ error: `Select field "${f.label}" must define at least one option` }, { status: 400 });
      }
      if (new Set(options).size !== options.length) {
        return NextResponse.json({ error: `Select field "${f.label}" contains duplicate options` }, { status: 400 });
      }
    }
    keys.add(f.field_key);
  }

  await withTransaction(async (tx) => {
    // Clear existing
    await tx("DELETE FROM intake_form_fields WHERE intake_form_id = $1", [form.id]);

    // Insert new
    for (const [idx, f] of fields.entries()) {
      await tx(
        `INSERT INTO intake_form_fields (
          intake_form_id, field_key, label, help_text, field_type, 
          required, sort_order, target_column_id, target_column_title, 
          target_column_type, settings_json
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          form.id, f.field_key, f.label, f.help_text, f.field_type,
          f.required || false, idx, f.target_column_id, f.target_column_title,
          f.target_column_type, JSON.stringify(f.settings_json || {})
        ]
      );
    }
    
    // Reset status to draft if it was invalid
    await tx(
      "UPDATE intake_forms SET status = 'draft', updated_at = now() WHERE id = $1 AND status = 'invalid'",
      [form.id]
    );
  });

  await logAudit({
    actorUserId: user.id,
    cycleId,
    actionType: "intake.fields_updated",
    targetType: "intake_form",
    targetId: form.id,
    metadata: { field_count: fields.length }
  });

  return NextResponse.json({ success: true });
}
