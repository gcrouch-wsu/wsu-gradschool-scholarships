import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canManageCycle } from "@/lib/admin";
import { logAudit } from "@/lib/audit";
import { query, withTransaction } from "@/lib/db";
import {
  INTAKE_ALLOWED_COLUMN_TYPES,
  INTAKE_ALLOWED_FIELD_TYPES,
} from "@/lib/intake";

export const runtime = "nodejs";

/**
 * POST: Publish the current draft of the intake form.
 */

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

  const { rows: forms } = await query<any>(
    "SELECT * FROM intake_forms WHERE cycle_id = $1",
    [cycleId]
  );
  const form = forms[0];
  if (!form) return NextResponse.json({ error: "Intake form not found" }, { status: 404 });

  const { rows: fields } = await query<any>(
    "SELECT * FROM intake_form_fields WHERE intake_form_id = $1 ORDER BY sort_order ASC",
    [form.id]
  );

  if (fields.length === 0) {
    return NextResponse.json({ error: "Cannot publish an empty form" }, { status: 400 });
  }

  // Section 16: Publish rules
  // 1. All mapped columns exist in the current schema snapshot
  const { rows: cycles } = await query<any>(
    "SELECT sheet_id, sheet_schema_snapshot_json FROM scholarship_cycles WHERE id = $1",
    [cycleId]
  );
  const cycleData = cycles[0];
  if (!cycleData?.sheet_id || !cycleData?.sheet_schema_snapshot_json) {
    return NextResponse.json({ error: "Cycle does not have a connected Smartsheet and synced schema" }, { status: 400 });
  }

  const snapshot = cycleData.sheet_schema_snapshot_json;
  const liveColumns = new Map<string, any>(snapshot.columns.map((c: any) => [String(c.id), c]));

  for (const f of fields) {
    if (!(INTAKE_ALLOWED_FIELD_TYPES as readonly string[]).includes(f.field_type)) {
      return NextResponse.json({ error: `Field "${f.label}" uses unsupported type ${f.field_type}` }, { status: 400 });
    }
    if (f.field_type === "file") {
      continue;
    }
    if (!f.target_column_id) {
      return NextResponse.json({ error: `Field "${f.label}" is missing a target column mapping` }, { status: 400 });
    }
    const liveCol = liveColumns.get(String(f.target_column_id));
    if (!liveCol) {
      return NextResponse.json({ error: `Mapped column "${f.target_column_title}" for field "${f.label}" not found in sheet schema` }, { status: 400 });
    }
    // all mapped columns are supported in v1
    if (!(INTAKE_ALLOWED_COLUMN_TYPES as readonly string[]).includes(liveCol.type)) {
      return NextResponse.json({ error: `Column type ${liveCol.type} for field "${f.label}" is not supported in v1` }, { status: 400 });
    }
    // all select options match the target Smartsheet picklist options
    if (f.field_type === "select" && liveCol.type === "PICKLIST") {
      const fieldOptions = (f.settings_json as any)?.options || [];
      const colOptions = (liveCol as any).options || [];
      if (fieldOptions.length !== colOptions.length) {
        return NextResponse.json({ error: `Field "${f.label}" options must match the Smartsheet picklist exactly` }, { status: 400 });
      }
      for (const opt of colOptions) {
        if (!fieldOptions.includes(opt)) {
          return NextResponse.json({ error: `Field "${f.label}" options must match the Smartsheet picklist exactly` }, { status: 400 });
        }
      }
    }
  }

  // Create immutable snapshot
  const { rows: lastVer } = await query<{ version_number: number }>(
    "SELECT version_number FROM intake_form_versions WHERE intake_form_id = $1 ORDER BY version_number DESC LIMIT 1",
    [form.id]
  );
  const nextVer = (lastVer[0]?.version_number || 0) + 1;

  const snapshot_json = {
    title: form.title,
    instructions_text: form.instructions_text,
    opens_at: form.opens_at,
    closes_at: form.closes_at,
    fields: fields.map(f => ({
      field_key: f.field_key,
      label: f.label,
      help_text: f.help_text,
      field_type: f.field_type,
      required: f.required,
      sort_order: f.sort_order,
      target_column_id: f.target_column_id,
      target_column_title: f.target_column_title,
      target_column_type: f.target_column_type,
      settings_json: f.settings_json
    }))
  };

  const { rows: newVersion } = await query<{ id: string }>(
    `INSERT INTO intake_form_versions (intake_form_id, version_number, status, snapshot_json, created_by_user_id, published_at)
     VALUES ($1, $2, 'published', $3, $4, now())
     RETURNING id`,
    [form.id, nextVer, JSON.stringify(snapshot_json), user.id]
  );

  await withTransaction(async (tx) => {
    // Supersede old
    await tx(
      "UPDATE intake_form_versions SET status = 'superseded' WHERE intake_form_id = $1 AND id != $2",
      [form.id, newVersion[0].id]
    );
    // Update main form
    await tx(
      "UPDATE intake_forms SET status = 'published', published_version_id = $1, updated_at = now() WHERE id = $2",
      [newVersion[0].id, form.id]
    );
  });

  await logAudit({
    actorUserId: user.id,
    cycleId,
    actionType: "intake.form_published",
    targetType: "intake_form",
    targetId: form.id,
    metadata: { version: nextVer }
  });

  return NextResponse.json({ success: true, version: nextVer });
}
