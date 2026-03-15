import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { decrypt } from "@/lib/encryption";
import { getRowAttachments } from "@/lib/smartsheet";

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

  const { rows: membership } = await query<{ role_id: string }>(
    `SELECT role_id FROM scholarship_memberships m
     JOIN scholarship_cycles c ON c.id = m.cycle_id
     WHERE m.user_id = $1 AND m.cycle_id = $2 AND m.status = 'active' AND c.status = 'active'`,
    [user.id, cycleId]
  );
  if (membership.length === 0) {
    return NextResponse.json({ error: "Not assigned to this cycle" }, { status: 403 });
  }

  const { rows: attachmentFields } = await query<{ id: string }>(
    `SELECT fc.id FROM field_configs fc
     JOIN field_permissions fp ON fp.field_config_id = fc.id
     WHERE fc.cycle_id = $1 AND fp.role_id = $2 AND fp.can_view = true
     AND (fc.purpose = 'attachment' OR fc.display_type = 'attachment_list')`,
    [cycleId, membership[0]!.role_id]
  );
  if (attachmentFields.length === 0) {
    return NextResponse.json(
      { error: "Your role does not have permission to view attachments" },
      { status: 403 }
    );
  }

  const { rows: cycles } = await query<{
    connection_id: string;
    sheet_id: number;
  }>(
    "SELECT connection_id, sheet_id FROM scholarship_cycles WHERE id = $1",
    [cycleId]
  );
  const cycle = cycles[0];
  if (!cycle?.connection_id || !cycle.sheet_id) {
    return NextResponse.json(
      { error: "Cycle has no sheet configured" },
      { status: 400 }
    );
  }

  const { rows: conn } = await query<{ encrypted_credentials: string }>(
    "SELECT encrypted_credentials FROM connections WHERE id = $1",
    [cycle.connection_id]
  );
  if (!conn[0]?.encrypted_credentials) {
    return NextResponse.json({ error: "Connection not found" }, { status: 500 });
  }

  let token: string;
  try {
    token = decrypt(conn[0].encrypted_credentials);
  } catch {
    return NextResponse.json(
      { error: "Could not decrypt credentials" },
      { status: 500 }
    );
  }

  const result = await getRowAttachments(token, cycle.sheet_id, rowIdNum);
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error ?? "Failed to fetch attachments" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    attachments: result.attachments ?? [],
  });
}
