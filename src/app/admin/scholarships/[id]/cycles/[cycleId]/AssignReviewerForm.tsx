"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { adminPrimaryButtonClass } from "@/components/admin/actionStyles";

interface AssignReviewerFormProps {
  cycleId: string;
  roles: { id: string; key: string; label: string }[];
  users: { id: string; email: string; first_name: string; last_name: string }[];
  existingUserIds: string[];
}

export function AssignReviewerForm({
  cycleId,
  roles,
  users,
  existingUserIds,
}: AssignReviewerFormProps) {
  const router = useRouter();
  const [userId, setUserId] = useState("");
  const [roleId, setRoleId] = useState(roles[0]?.id ?? "");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const availableUsers = users.filter((u) => !existingUserIds.includes(u.id));
  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) return availableUsers;
    const q = searchQuery.toLowerCase().trim();
    return availableUsers.filter(
      (u) =>
        u.last_name.toLowerCase().includes(q) ||
        u.first_name.toLowerCase().includes(q) ||
        (u.email ?? "").toLowerCase().includes(q)
    );
  }, [availableUsers, searchQuery]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!userId || !roleId) return;
    setLoading(true);
    try {
      const res = await fetch("/api/admin/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cycleId, userId, roleId }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to assign");
        return;
      }
      setUserId("");
      router.refresh();
    } catch {
      setError("An error occurred");
    } finally {
      setLoading(false);
    }
  }

  if (roles.length === 0) return null;

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm"
    >
      <div className="grid gap-4 md:grid-cols-[minmax(0,1.8fr)_minmax(180px,0.8fr)_auto] md:items-end">
        <div className="min-w-0">
          <label className="block text-xs font-medium uppercase tracking-wide text-zinc-500">
            Reviewer
          </label>
          <div className="mt-2 space-y-2">
            {availableUsers.length > 10 && (
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name or email..."
                className="block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
              />
            )}
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              required
              className="block w-full min-w-0 rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
            >
              <option value="">- Select -</option>
              {filteredUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.last_name}, {u.first_name} ({u.email})
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="min-w-0">
          <label className="block text-xs font-medium uppercase tracking-wide text-zinc-500">
            Role
          </label>
          <select
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
            className="mt-2 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
          >
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={loading || availableUsers.length === 0}
          className={adminPrimaryButtonClass}
        >
          {loading ? "Adding..." : "Assign"}
        </button>
      </div>
      {availableUsers.length === 0 && (
        <p className="mt-3 text-sm text-zinc-500">
          All available reviewers are already assigned to this cycle.
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    </form>
  );
}
