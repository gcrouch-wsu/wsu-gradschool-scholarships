import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { canAccessAdmin } from "@/lib/admin";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { SessionWarning } from "@/components/SessionWarning";

export default async function ReviewerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.must_change_password) redirect("/change-password");
  const hasAdminAccess = await canAccessAdmin(user.id, user.is_platform_admin);

  return (
    <div className="min-h-screen bg-zinc-50">
      <a
        href="#main-content"
        className="fixed left-4 top-0 z-[100] -translate-y-full rounded-b-md bg-white px-3 py-2 text-sm font-medium text-zinc-900 shadow-md ring-2 ring-[var(--wsu-crimson)] transition-transform duration-200 focus:translate-y-0"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/reviewer" className="flex items-center gap-2.5 rounded-sm outline-offset-2 hover:opacity-90">
            <Image
              src="/wsu-logo.png"
              alt=""
              width={32}
              height={32}
              className="h-8 w-8 shrink-0 object-contain"
              aria-hidden
            />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--wsu-crimson)]">WSU Graduate School</p>
              <p className="text-sm font-semibold tracking-tight text-zinc-900">Scholarship Review</p>
            </div>
          </Link>
          <nav aria-label="Reviewer" className="flex items-center gap-3">
            {hasAdminAccess && (
              <Link
                href="/admin"
                className="rounded-sm text-sm text-[var(--wsu-gray)] underline-offset-2 hover:text-[var(--wsu-crimson)] hover:underline"
              >
                Admin
              </Link>
            )}
            <span className="text-sm text-[var(--wsu-gray)]">
              {user.first_name} {user.last_name}
            </span>
            <LogoutButton className="text-sm text-[var(--wsu-gray)] hover:text-[var(--wsu-crimson)]" />
          </nav>
        </div>
      </header>
      <main id="main-content" className="mx-auto max-w-6xl px-4 py-8">
        {children}
      </main>
      <SessionWarning />
    </div>
  );
}
