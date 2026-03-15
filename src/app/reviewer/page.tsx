import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { query } from "@/lib/db";

export default async function ReviewerPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.must_change_password) redirect("/change-password");

  const { rows: assignments } = await query<{
    cycle_id: string;
    program_id: string;
    program_name: string;
    cycle_label: string;
    cycle_key: string;
    role_label: string;
    status: string;
  }>(
    `SELECT c.id as cycle_id, p.id as program_id, p.name as program_name,
            c.cycle_label, c.cycle_key, r.label as role_label, c.status
     FROM scholarship_memberships m
     JOIN scholarship_cycles c ON c.id = m.cycle_id
     JOIN scholarship_programs p ON p.id = c.program_id
     JOIN roles r ON r.id = m.role_id
     WHERE m.user_id = $1 AND m.status = 'active' AND c.status = 'active'`,
    [user.id]
  );

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/reviewer" className="font-semibold text-zinc-900">
            Scholarship Review Platform
          </Link>
          <Link href="/admin" className="text-sm text-zinc-600 hover:text-zinc-900">
            Admin
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <h1 className="mb-6 text-2xl font-semibold text-zinc-900">
          My scholarships
        </h1>
        {assignments.length === 0 ? (
          <p className="text-zinc-600">
            You are not assigned to any active scholarship cycles.
          </p>
        ) : (
          <div className="space-y-2">
            {assignments.map((a) => (
              <Link
                key={a.cycle_id}
                href={`/reviewer/${a.cycle_id}`}
                className="block rounded-lg border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-zinc-300"
              >
                <span className="font-medium text-zinc-900">
                  {a.program_name} – {a.cycle_label}
                </span>
                <span className="ml-2 text-sm text-zinc-500">
                  ({a.role_label})
                </span>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
