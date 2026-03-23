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

      <div className="mt-8 space-y-2">
        {users.map((u) => (
          <div
            key={u.id}
            className="flex items-center justify-between rounded border border-zinc-200 bg-white px-4 py-3"
          >
            <div>
              <span className="font-medium text-zinc-900">
                {u.first_name} {u.last_name}
              </span>
              <span className="ml-2 text-zinc-500">{u.email}</span>
              {u.is_platform_admin && (
                <span className="ml-2 rounded bg-zinc-200 px-1.5 py-0.5 text-xs">
                  Admin
                </span>
              )}
              {u.must_change_password && (
                <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                  Must change password
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <span
                className={`rounded px-2 py-1 text-xs font-medium ${
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
