"use client";

import Image from "next/image";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") ?? "/admin";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Login failed");
        return;
      }
      if (data.mustChangePassword) {
        router.push("/change-password");
        return;
      }
      router.push(redirect);
      router.refresh();
    } catch {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-100">
      <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <Image
            src="/wsu-logo.png"
            alt=""
            width={40}
            height={40}
            className="h-10 w-10 shrink-0 object-contain"
            priority
            aria-hidden
          />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--wsu-crimson)]">WSU Graduate School</p>
            <h1 className="mt-0.5 text-lg font-semibold tracking-tight text-zinc-900">Scholarship Review</h1>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-zinc-700">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-zinc-700">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
            />
          </div>
          {error && (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
            >
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            aria-busy={loading}
            className="w-full rounded-md bg-[var(--wsu-crimson)] px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-[var(--wsu-crimson-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}

function LoginSkeleton() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-100 px-4">
      <div
        className="h-[340px] w-full max-w-sm animate-pulse rounded-lg border border-zinc-200 bg-white p-8 shadow-sm"
        aria-hidden
      >
        <div className="mb-6 flex gap-3">
          <div className="h-10 w-10 rounded bg-zinc-200" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="h-3 w-28 rounded bg-zinc-200" />
            <div className="h-5 w-40 rounded bg-zinc-200" />
          </div>
        </div>
        <div className="space-y-4">
          <div className="h-16 rounded-md bg-zinc-100" />
          <div className="h-16 rounded-md bg-zinc-100" />
          <div className="h-10 rounded-md bg-zinc-200" />
        </div>
      </div>
      <p className="sr-only">Loading sign-in…</p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoginSkeleton />}>
      <LoginForm />
    </Suspense>
  );
}
