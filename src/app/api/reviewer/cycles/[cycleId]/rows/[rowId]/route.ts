import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { getSmartsheetWriteTimeoutMs } from "@/lib/db";
import { getLiveColumnIds } from "@/lib/reviewer";
import { query } from "@/lib/db";
import { decrypt } from "@/lib/encryption";
import { getEffectiveReviewerConfig } from "@/lib/reviewer-config";
import { getSheetRows, updateRowCells } from "@/lib/smartsheet";

async function getRowData(cycleId: string, userId: string, rowId: number) {
  const { rows: membership } = await query<{ role_id: string }>(
    `SELECT role_id FROM scholarship_memberships m
     JOIN scholarship_cycles c ON c.id = m.cycle_id
     WHERE m.user_id = $1 AND m.cycle_id = $2 AND m.status = 'active' AND c.status = 'active'`,
    [userId, cycleId]
  );
  if (membership.length === 0) return null;

  const { rows: cycles } = await query<{
    connection_id: string;
    sheet_id: number;
  }>(
    "SELECT connection_id, sheet_id FROM scholarship_cycles WHERE id = $1",
    [cycleId]
  );
  const cycle = cycles[0];
  if (!cycle?.connection_id || !cycle.sheet_id) return null;

  const { rows: conn } = await query<{ encrypted_credentials: string }>(
    "SELECT encrypted_credentials FROM connections WHERE id = $1",
    [cycle.connection_id]
  );
  if (!conn[0]?.encrypted_credentials) return null;

  let token: string;
  try {
    token = decrypt(conn[0].encrypted_credentials);
  } catch {
    return null;
  }

  const result = await getSheetRows(token, cycle.sheet_id);
  if (!result.ok || !result.rows) return null;

  const row = result.rows.find((r) => r.id === rowId);
  return row ? { row, token, sheetId: cycle.sheet_id, roleId: membership[0]!.role_id } : null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ cycleId: string; rowId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { cycleId, rowId } = await params;
  const rowIdNum = parseInt(rowId, 10);
  if (isNaN(rowIdNum)) {
    return NextResponse.json({ error: "Invalid row ID" }, { status: 400 });
  }

  const data = await getRowData(cycleId, user.id, rowIdNum);
  if (!data) {
    return NextResponse.json(
      { error: "Row not found or access denied" },
      { status: 404 }
    );
  }

  const liveColumnIds = await getLiveColumnIds(cycleId);
  if (!liveColumnIds) {
    return NextResponse.json(
      { error: "Could not verify sheet schema. Check connection and sheet." },
      { status: 400 }
    );
  }

  const effectiveConfig = await getEffectiveReviewerConfig(cycleId);
  const rolePermissions = effectiveConfig.permissions.filter(
    (permission) => permission.role_id === data.roleId
  );
  const viewablePermissionByFieldId = new Map(
    rolePermissions
      .filter((permission) => permission.can_view)
      .map((permission) => [permission.field_config_id, permission])
  );
  const fieldConfigs = effectiveConfig.fieldConfigs
    .filter((fieldConfig) => viewablePermissionByFieldId.has(fieldConfig.id))
    .map((fieldConfig) => ({
      ...fieldConfig,
      can_edit: viewablePermissionByFieldId.get(fieldConfig.id)?.can_edit ?? false,
    }));

  const viewSettings = effectiveConfig.viewConfig?.settings_json as {
    blindReview?: boolean;
    hiddenFieldKeys?: string[];
  } | null;
  const blindReview = viewSettings?.blindReview ?? false;
  const hiddenFieldKeys = new Set(viewSettings?.hiddenFieldKeys ?? []);

  const sectionFields = effectiveConfig.sectionFields;
  const viewSections = effectiveConfig.viewSections;
  const fieldIdToSectionKey = Object.fromEntries(
    sectionFields.map((sf) => {
      const vs = viewSections.find((s) => s.id === sf.view_section_id);
      return [sf.field_config_id, vs?.section_key ?? "main"];
    })
  );

  await query(
    `INSERT INTO user_cycle_progress (user_id, cycle_id, last_row_id, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id, cycle_id) DO UPDATE SET last_row_id = $3, updated_at = now()`,
    [user.id, cycleId, rowIdNum]
  );

  const validConfigs = fieldConfigs.filter((f) => liveColumnIds.has(String(f.source_column_id)));
  const configsForReview = blindReview
    ? validConfigs.filter((f) => !hiddenFieldKeys.has(f.field_key))
    : validConfigs;
  const fields = configsForReview.map((f) => ({
    fieldKey: f.field_key,
    sourceColumnId: f.source_column_id,
    purpose: f.purpose,
    displayLabel: f.display_label,
    helperText: f.help_text ?? null,
    displayType: f.display_type,
    canEdit: f.can_edit,
    sectionKey: fieldIdToSectionKey[f.id] ?? "main",
    value: data.row.cells[f.source_column_id],
  }));

  return NextResponse.json({
    rowId: data.row.id,
    fields,
    loadedAt: new Date().toISOString(),
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ cycleId: string; rowId: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { cycleId, rowId } = await params;
  const rowIdNum = parseInt(rowId, 10);
  if (isNaN(rowIdNum)) {
    return NextResponse.json({ error: "Invalid row ID" }, { status: 400 });
  }

  const data = await getRowData(cycleId, user.id, rowIdNum);
  if (!data) {
    return NextResponse.json(
      { error: "Row not found or access denied" },
      { status: 404 }
    );
  }

  const liveColumnIds = await getLiveColumnIds(cycleId);
  if (!liveColumnIds) {
    return NextResponse.json(
      { error: "Could not verify sheet schema. Check connection and sheet." },
      { status: 400 }
    );
  }

  const effectiveConfig = await getEffectiveReviewerConfig(cycleId);
  const rolePermissions = effectiveConfig.permissions.filter(
    (permission) => permission.role_id === data.roleId
  );
  const editableIds = new Set(
    effectiveConfig.fieldConfigs
      .filter((fieldConfig) =>
        rolePermissions.some(
          (permission) => permission.field_config_id === fieldConfig.id && permission.can_edit
        )
      )
      .map((fieldConfig) => String(fieldConfig.source_column_id))
      .filter((id) => liveColumnIds.has(id))
  );

  const body = await request.json();
  const updates = body?.cells as Array<{ columnId: number; value: unknown }>;
  if (!Array.isArray(updates)) {
    return NextResponse.json(
      { error: "cells array is required" },
      { status: 400 }
    );
  }

  // Any column in the request that is not in editableIds is a forbidden write — reject the whole request.
  const forbidden = updates.filter((c) => c.columnId != null && !editableIds.has(String(c.columnId)));
  if (forbidden.length > 0) {
    return NextResponse.json(
      { error: "Write permission denied: one or more columns are not editable by your role" },
      { status: 403 }
    );
  }
  const cells = updates.filter((c) => c.columnId != null);
  if (cells.length === 0) {
    return NextResponse.json(
      { error: "No cells to update" },
      { status: 400 }
    );
  }

  const timeoutMs = await getSmartsheetWriteTimeoutMs();
  const result = await updateRowCells(
    data.token,
    data.sheetId,
    rowIdNum,
    cells.map((c) => ({ columnId: c.columnId, value: c.value })),
    timeoutMs
  );

  if (!result.ok) {
    const isRateLimit = result.httpStatus === 429 || result.errorCode === 4003;
    const isRetriable = isRateLimit || result.error?.includes("timeout") || result.httpStatus === 503;
    return NextResponse.json(
      { error: result.error ?? "Save failed", retriable: isRetriable },
      { status: isRateLimit ? 429 : 500 }
    );
  }

  const beforeAfter = Object.fromEntries(
    cells.map((c) => [
      String(c.columnId),
      { before: data.row.cells[c.columnId], after: c.value },
    ])
  );

  await query(
    `INSERT INTO user_cycle_progress (user_id, cycle_id, last_row_id, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (user_id, cycle_id) DO UPDATE SET last_row_id = $3, updated_at = now()`,
    [user.id, cycleId, rowIdNum]
  );

  await logAudit({
    actorUserId: user.id,
    cycleId,
    actionType: "reviewer.score_saved",
    targetType: "row",
    targetId: String(rowIdNum),
    metadata: { rowId: rowIdNum, cells: beforeAfter },
  });

  return NextResponse.json({ success: true });
}
