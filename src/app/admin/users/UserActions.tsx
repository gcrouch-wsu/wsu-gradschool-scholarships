"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface UserActionsProps {
  userId: string;
  status: string;
}

export function UserActions({ userId, status }: UserActionsProps) {
  const router = useRouter();
  const [showReset, setShowReset] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
    <div className="flex items-center gap-2">
      {showReset ? (
        <form onSubmit={handleResetPassword} className="flex items-center gap-2">
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New password"
            minLength={8}
            className="rounded border border-zinc-300 px-2 py-1 text-sm"
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded bg-zinc-900 px-2 py-1 text-sm text-white disabled:opacity-50"
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
            className="text-sm text-zinc-600 hover:underline"
          >
            Cancel
          </button>
          {error && <span className="text-sm text-red-600">{error}</span>}
        </form>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setShowReset(true)}
            disabled={loading}
            className="text-sm text-zinc-600 hover:underline disabled:opacity-50"
          >
            Reset password
          </button>
          <button
            type="button"
            onClick={handleToggleStatus}
            disabled={loading}
            className="text-sm text-zinc-600 hover:underline disabled:opacity-50"
          >
            {status === "active" ? "Deactivate" : "Activate"}
          </button>
        </>
      )}
    </div>
  );
}
