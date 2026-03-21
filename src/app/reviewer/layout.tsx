import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { SessionWarning } from "@/components/SessionWarning";

export default async function ReviewerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.must_change_password) redirect("/change-password");

  return (
    <div className="min-h-screen bg-zinc-50">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Link href="/reviewer" className="flex items-center gap-2.5">
            <img src="/wsu-logo.svg" alt="" aria-hidden="true" className="h-8 w-8 shrink-0" />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--wsu-crimson)]">WSU Graduate School</p>
              <p className="text-sm font-semibold tracking-tight text-zinc-900">Scholarship Review</p>
            </div>
          </Link>
          <Link href="/admin" className="text-sm text-[var(--wsu-gray)] hover:text-[var(--wsu-crimson)]">
            Admin
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        {children}
      </main>
      <SessionWarning />
    </div>
  );
}
