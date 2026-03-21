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
        <div className="mx-auto flex h-auto min-h-14 max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3">
          <Link href="/admin" className="flex items-center gap-2.5">
            <img src="/wsu-logo.png" alt="" aria-hidden="true" className="h-8 w-8 shrink-0" />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--wsu-crimson)]">WSU Graduate School</p>
              <p className="text-sm font-semibold tracking-tight text-zinc-900">Scholarship Review</p>
            </div>
          </Link>
          <Link href="/reviewer" className="text-sm text-[var(--wsu-gray)] hover:text-[var(--wsu-crimson)]">
            My scholarships
          </Link>
          <nav className="flex flex-wrap items-center gap-3">
            <Link href="/admin/scholarships" className="text-sm text-[var(--wsu-gray)] hover:text-[var(--wsu-crimson)]">
              Scholarships
            </Link>
            {user.is_platform_admin && (
              <Link href="/admin/users" className="text-sm text-[var(--wsu-gray)] hover:text-[var(--wsu-crimson)]">
                Users
              </Link>
            )}
            {user.is_platform_admin && (
              <>
                <Link href="/admin/audit" className="text-sm text-[var(--wsu-gray)] hover:text-[var(--wsu-crimson)]">
                  Audit
                </Link>
                <Link href="/admin/settings" className="text-sm text-[var(--wsu-gray)] hover:text-[var(--wsu-crimson)]">
                  Settings
                </Link>
                <Link href="/admin/connections" className="text-sm text-[var(--wsu-gray)] hover:text-[var(--wsu-crimson)]">
                  Connections
                </Link>
              </>
            )}
            <span className="text-sm text-[var(--wsu-gray)]">
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
