import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { canManageCycle } from "@/lib/admin";
import { logAudit } from "@/lib/audit";
import { query } from "@/lib/db";

export const runtime = "nodejs";

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+/, "") // strip leading non-letter chars so key always starts with a letter
    .replace(/-+$/, "")
    .slice(0, 50) || "role";
}

function isValidKey(key: string): boolean {
  return /^[a-z][a-z0-9-]{0,49}$/.test(key);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id: cycleId } = await params;
  if (!await canManageCycle(user.id, user.is_platform_admin, cycleId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json() as { label?: string; key?: string };
  const { label, key: suppliedKey } = body;

  if (!label?.trim()) {
    return NextResponse.json({ error: "label is required" }, { status: 422 });
  }

  const { rows: countRows } = await query<{ count: string }>(
    "SELECT COUNT(*)::text AS count FROM roles WHERE cycle_id = $1",
    [cycleId]
  );
  if (parseInt(countRows[0]?.count ?? "0", 10) >= 10) {
    return NextResponse.json({ error: "Maximum of 10 roles per cycle" }, { status: 422 });
  }

  let key = suppliedKey?.trim() ? suppliedKey.trim() : slugify(label.trim());
  if (!isValidKey(key)) {
    return NextResponse.json(
      { error: "key must be lowercase letters, digits, and hyphens, starting with a letter, 1–50 characters" },
      { status: 422 }
    );
  }

  // Ensure uniqueness — append suffix if auto-generated key collides
  if (!suppliedKey?.trim()) {
    const { rows: collision } = await query<{ key: string }>(
      "SELECT key FROM roles WHERE cycle_id = $1 AND key LIKE $2",
      [cycleId, `${key}%`]
    );
    const taken = new Set(collision.map((r) => r.key));
    if (taken.has(key)) {
      let suffix = 2;
      while (taken.has(`${key.slice(0, 50 - String(suffix).length - 1)}-${suffix}`)) suffix++;
      key = `${key.slice(0, 50 - String(suffix).length - 1)}-${suffix}`;
    }
  } else {
    const { rows: keyCheck } = await query<{ id: string }>(
      "SELECT id FROM roles WHERE cycle_id = $1 AND key = $2",
      [cycleId, key]
    );
    if (keyCheck.length > 0) {
      return NextResponse.json({ error: `Key "${key}" is already in use on this cycle` }, { status: 422 });
    }
  }

  const { rows: maxRows } = await query<{ max: number | null }>(
    "SELECT MAX(sort_order) AS max FROM roles WHERE cycle_id = $1",
    [cycleId]
  );
  const sortOrder = (maxRows[0]?.max ?? -1) + 1;

  const { rows } = await query<{ id: string; key: string; label: string; sort_order: number }>(
    `INSERT INTO roles (cycle_id, key, label, sort_order)
     VALUES ($1, $2, $3, $4)
     RETURNING id, key, label, sort_order`,
    [cycleId, key, label.trim(), sortOrder]
  );
  const role = rows[0]!;

  await logAudit({
    actorUserId: user.id,
    cycleId,
    actionType: "role.created",
    targetType: "role",
    targetId: role.id,
    metadata: { key: role.key, label: role.label },
  });

  return NextResponse.json(role, { status: 201 });
}
