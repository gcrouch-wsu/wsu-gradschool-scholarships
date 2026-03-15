import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { getAdminProgramIds } from "@/lib/admin";
import { query } from "@/lib/db";

export default async function ScholarshipsPage() {
  const user = await getSessionUser();
  if (!user) return null;
  const adminProgramIds = await getAdminProgramIds(user.id);
  const isPlatformAdmin = user.is_platform_admin;
  const canManageAll = isPlatformAdmin;
  const programIds = canManageAll ? null : Array.isArray(adminProgramIds) ? adminProgramIds : [];

  if (!canManageAll && (programIds ?? []).length === 0) {
    return (
      <div className="text-zinc-600">
        You do not have permission to manage any scholarships.
      </div>
    );
  }

  const { rows: programs } = await query<{
    id: string;
    slug: string;
    name: string;
    description: string | null;
    status: string;
  }>(
    canManageAll
      ? "SELECT id, slug, name, description, status FROM scholarship_programs ORDER BY name"
      : `SELECT id, slug, name, description, status FROM scholarship_programs WHERE id = ANY($1::uuid[]) ORDER BY name`,
    canManageAll ? [] : [programIds ?? []]
  );

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-zinc-900">Scholarships</h1>
        {isPlatformAdmin && (
          <Link
            href="/admin/scholarships/new"
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
          >
            Add program
          </Link>
        )}
      </div>

      <div className="space-y-4">
        {programs.length === 0 ? (
          <p className="text-zinc-600">No scholarship programs yet.</p>
        ) : (
          programs.map((p) => (
            <div
              key={p.id}
              className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <div>
                  <Link
                    href={`/admin/scholarships/${p.id}`}
                    className="font-medium text-zinc-900 hover:underline"
                  >
                    {p.name}
                  </Link>
                  <p className="text-sm text-zinc-500">{p.slug}</p>
                  {p.description && (
                    <p className="mt-1 text-sm text-zinc-600">{p.description}</p>
                  )}
                </div>
                <span
                  className={`rounded px-2 py-1 text-xs font-medium ${
                    p.status === "active"
                      ? "bg-green-100 text-green-800"
                      : "bg-zinc-100 text-zinc-600"
                  }`}
                >
                  {p.status}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
