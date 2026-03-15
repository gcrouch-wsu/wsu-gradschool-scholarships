import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { canAccessAdmin } from "@/lib/admin";
import Link from "next/link";
import { LogoutButton } from "./LogoutButton";
import { SessionWarning } from "@/components/SessionWarning";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) {
    redirect("/login?redirect=/admin");
  }
  if (user.must_change_password) {
    redirect("/change-password");
  }
  const hasAdminAccess = await canAccessAdmin(user.id, user.is_platform_admin);
  if (!hasAdminAccess) {
    redirect("/reviewer");
  }

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/admin" className="font-semibold text-zinc-900">
            Scholarship Review Platform
          </Link>
          <Link href="/reviewer" className="text-sm text-zinc-600 hover:text-zinc-900">
            My scholarships
          </Link>
          <nav className="flex items-center gap-4">
            <Link href="/admin/scholarships" className="text-sm text-zinc-600 hover:text-zinc-900">
              Scholarships
            </Link>
            {user.is_platform_admin && (
              <Link href="/admin/users" className="text-sm text-zinc-600 hover:text-zinc-900">
                Users
              </Link>
            )}
            {user.is_platform_admin && (
              <>
                <Link href="/admin/audit" className="text-sm text-zinc-600 hover:text-zinc-900">
                  Audit
                </Link>
                <Link href="/admin/settings" className="text-sm text-zinc-600 hover:text-zinc-900">
                  Settings
                </Link>
                <Link href="/admin/connections" className="text-sm text-zinc-600 hover:text-zinc-900">
                  Connections
                </Link>
              </>
            )}
            <span className="text-sm text-zinc-500">
              {user.first_name} {user.last_name}
            </span>
            <LogoutButton />
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      <SessionWarning />
    </div>
  );
}
