import Link from "next/link";
import { getSessionUser } from "@/lib/auth";

export default async function AdminDashboardPage() {
  const user = await getSessionUser();
  const isPlatformAdmin = user?.is_platform_admin ?? false;

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-zinc-900">Admin Dashboard</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link
          href="/admin/scholarships"
          className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm transition hover:border-zinc-300"
        >
          <h2 className="font-medium text-zinc-900">Scholarships</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Manage programs and cycles
          </p>
        </Link>
        {isPlatformAdmin && (
          <Link
            href="/admin/users"
            className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm transition hover:border-zinc-300"
          >
            <h2 className="font-medium text-zinc-900">Users</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Create and manage user accounts
            </p>
          </Link>
        )}
        {isPlatformAdmin && (
          <Link
            href="/admin/connections"
            className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm transition hover:border-zinc-300"
          >
            <h2 className="font-medium text-zinc-900">Connections</h2>
            <p className="mt-1 text-sm text-zinc-600">
              Smartsheet API connections (platform admin only)
            </p>
          </Link>
        )}
      </div>
    </div>
  );
}
