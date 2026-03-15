import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { query } from "@/lib/db";

export async function GET() {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.is_platform_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { rows } = await query<{
    id: string;
    slug: string;
    name: string;
    description: string | null;
    status: string;
    created_at: string;
  }>(
    "SELECT id, slug, name, description, status, created_at FROM scholarship_programs ORDER BY name"
  );
  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.is_platform_admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { slug, name, description } = body;
  if (!slug || !name || typeof slug !== "string" || typeof name !== "string") {
    return NextResponse.json(
      { error: "slug and name are required" },
      { status: 400 }
    );
  }

  const safeSlug = slug.trim().toLowerCase().replace(/\s+/g, "-");
  if (!/^[a-z0-9-]+$/.test(safeSlug)) {
    return NextResponse.json(
      { error: "slug must contain only lowercase letters, numbers, and hyphens" },
      { status: 400 }
    );
  }

  try {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO scholarship_programs (slug, name, description, status)
       VALUES ($1, $2, $3, 'active')
       RETURNING id`,
      [safeSlug, name.trim(), description?.trim() ?? null]
    );
    const newId = rows[0]!.id;
    await logAudit({
      actorUserId: user.id,
      actionType: "program.created",
      targetType: "program",
      targetId: newId,
      metadata: { slug: safeSlug, name: name.trim() },
    });
    return NextResponse.json({ id: newId, slug: safeSlug });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json(
        { error: "A program with this slug already exists" },
        { status: 409 }
      );
    }
    throw err;
  }
}
