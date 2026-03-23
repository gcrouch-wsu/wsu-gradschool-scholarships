import { getSessionUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { CreateUserForm } from "./CreateUserForm";
import { UserActions } from "./UserActions";

export default async function UsersPage() {
  const user = await getSessionUser();
  if (!user?.is_platform_admin) {
    return (
      <div className="text-zinc-600">
        You do not have permission to manage users.
      </div>
    );
  }

  const { rows: users } = await query<{
    id: string;
    email: string;
    first_name: string;
    last_name: string;
    status: string;
    is_platform_admin: boolean;
    must_change_password: boolean;
    created_at: string;
  }>(
    "SELECT id, email, first_name, last_name, status, is_platform_admin, must_change_password, created_at FROM users ORDER BY last_name, first_name"
  );

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-zinc-900">Users</h1>

      <CreateUserForm />

      <div className="mt-8 space-y-3">
        {users.map((u) => (
          <div
            key={u.id}
            className="grid gap-4 rounded-xl border border-zinc-200 bg-white px-4 py-4 shadow-sm md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-zinc-900">
                  {u.first_name} {u.last_name}
                </span>
                {u.is_platform_admin && (
                  <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-medium text-zinc-700">
                    Admin
                  </span>
                )}
                {u.must_change_password && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                    Must change password
                  </span>
                )}
              </div>
              <p className="mt-1 truncate text-sm text-zinc-500">{u.email}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 md:justify-end">
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  u.status === "active"
                    ? "bg-green-100 text-green-800"
                    : "bg-zinc-100 text-zinc-600"
                }`}
              >
                {u.status}
              </span>
              <UserActions userId={u.id} status={u.status} isSelf={u.id === user.id} isPlatformAdmin={u.is_platform_admin} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
