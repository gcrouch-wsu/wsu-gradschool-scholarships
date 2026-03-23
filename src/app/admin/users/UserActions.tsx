"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface UserActionsProps {
  userId: string;
  status: string;
  isSelf: boolean;
  isPlatformAdmin: boolean;
}

export function UserActions({ userId, status, isSelf, isPlatformAdmin }: UserActionsProps) {
  const router = useRouter();
  const [showReset, setShowReset] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const secondaryButtonClass =
    "inline-flex items-center rounded-md border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50";
  const destructiveButtonClass =
    "inline-flex items-center rounded-md border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50";

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resetPassword: newPassword }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed");
        return;
      }
      setShowReset(false);
      setNewPassword("");
      router.refresh();
    } catch {
      setError("An error occurred");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Permanently delete this user? This cannot be undone.")) return;
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to delete");
        return;
      }
      router.refresh();
    } catch {
      setError("An error occurred");
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleStatus() {
    const next = status === "active" ? "inactive" : "active";
    if (!confirm(`Set user to ${next}?`)) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) return;
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 md:justify-end">
      {showReset ? (
        <form onSubmit={handleResetPassword} className="flex flex-wrap items-center gap-2 md:justify-end">
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password"
            minLength={8}
            className="w-44 rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
          />
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center rounded-md bg-[var(--wsu-crimson)] px-3 py-1.5 text-xs font-medium text-white hover:bg-[var(--wsu-crimson-hover)] disabled:opacity-50"
          >
            Set
          </button>
          <button
            type="button"
            onClick={() => {
              setShowReset(false);
              setNewPassword("");
              setError("");
            }}
            className={secondaryButtonClass}
          >
            Cancel
          </button>
          {error && <span className="basis-full text-xs text-red-600 md:text-right">{error}</span>}
        </form>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setShowReset(true)}
            disabled={loading}
            className={secondaryButtonClass}
          >
            Reset password
          </button>
          <button
            type="button"
            onClick={handleToggleStatus}
            disabled={loading}
            className={secondaryButtonClass}
          >
            {status === "active" ? "Deactivate" : "Activate"}
          </button>
          {!isSelf && !isPlatformAdmin && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={loading}
              className={destructiveButtonClass}
            >
              Delete
            </button>
          )}
        </>
      )}
    </div>
  );
}
