"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

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
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
      <div>
        <label className="block text-xs font-medium text-zinc-600">User</label>
        {availableUsers.length > 10 && (
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name or email…"
            className="mt-1 block w-48 rounded-md border border-zinc-300 px-2 py-1.5 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
          />
        )}
        <select
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          required
          className="mt-1 rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
        >
          <option value="">— Select —</option>
          {filteredUsers.map((u) => (
            <option key={u.id} value={u.id}>
              {u.last_name}, {u.first_name} ({u.email})
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-medium text-zinc-600">Role</label>
        <select
          value={roleId}
          onChange={(e) => setRoleId(e.target.value)}
          className="mt-1 rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
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
        className="rounded-md bg-[var(--wsu-crimson)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--wsu-crimson-hover)] disabled:opacity-50"
      >
        {loading ? "Adding…" : "Assign"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
