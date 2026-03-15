"use client";

import { useEffect, useState } from "react";

export function SessionWarning() {
  const [show, setShow] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    async function check() {
      const res = await fetch("/api/auth/session-status");
      if (!res.ok) return;
      const data = await res.json();
      if (data.showWarning) {
        setShow(true);
        setRemaining(data.remainingMinutes);
      } else {
        setShow(false);
      }
    }
    check();
    interval = setInterval(check, 60_000);
    return () => clearInterval(interval);
  }, []);

  if (!show) return null;

  return (
    <div
      role="alert"
      className="fixed bottom-4 left-4 right-4 z-50 rounded-lg border border-amber-300 bg-amber-50 p-4 shadow-lg sm:left-auto sm:right-4 sm:max-w-md"
    >
      <p className="font-medium text-amber-900">
        Your session will expire in about {remaining ?? "a few"} minutes.
      </p>
      <p className="mt-1 text-sm text-amber-800">
        Save your work and sign in again to continue.
      </p>
      <a
        href="/login"
        className="mt-2 inline-block text-sm font-medium text-amber-900 underline hover:no-underline"
      >
        Sign in again
      </a>
    </div>
  );
}
