"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  adminDestructiveButtonSmClass,
  adminInlinePanelClass,
  adminPrimaryButtonClass,
} from "@/components/admin/actionStyles";

interface ProgramAdminsSectionProps {
  programId: string;
}

export function ProgramAdminsSection({ programId }: ProgramAdminsSectionProps) {
  const router = useRouter();
  const [admins, setAdmins] = useState<{ user_id: string; email: string; first_name: string; last_name: string }[]>([]);
  const [users, setUsers] = useState<{ id: string; email: string; first_name: string; last_name: string }[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch(`/api/admin/programs/${programId}/admins`).then((r) => r.json()),
      fetch("/api/admin/users").then((r) => r.json()),
    ]).then(([adminsData, usersData]) => {
      setAdmins(Array.isArray(adminsData) ? adminsData : []);
      setUsers(Array.isArray(usersData) ? usersData : []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [programId]);

  const adminIds = new Set(admins.map((a) => a.user_id));
  const availableUsers = users.filter((u) => !adminIds.has(u.id));

  async function handleAdd() {
    if (!selectedUserId) return;
    setAdding(true);
    try {
      const res = await fetch(`/api/admin/programs/${programId}/admins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selectedUserId }),
      });
      if (res.ok) {
        setSelectedUserId("");
        router.refresh();
        const adminsRes = await fetch(`/api/admin/programs/${programId}/admins`);
        const data = await adminsRes.json();
        setAdmins(Array.isArray(data) ? data : []);
      }
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(userId: string) {
    if (!confirm("Remove this scholarship admin?")) return;
    const res = await fetch(`/api/admin/programs/${programId}/admins?userId=${userId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      router.refresh();
      setAdmins((prev) => prev.filter((a) => a.user_id !== userId));
    }
  }

  if (loading) return <div className="text-sm text-zinc-500">Loading...</div>;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <h2 className="mb-3 text-lg font-medium text-zinc-900">Scholarship admins</h2>
      <p className="mb-3 text-sm text-zinc-600">
        Users who can manage cycles, builder, and assignments for this program. They cannot view Smartsheet tokens.
      </p>
      <div className={adminInlinePanelClass}>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div className="min-w-0">
            <label className="block text-xs font-medium uppercase tracking-wide text-zinc-500">
              Add scholarship admin
            </label>
            <select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
              className="mt-2 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
            >
              <option value="">- Select a user -</option>
              {availableUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.last_name}, {u.first_name} ({u.email})
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={handleAdd}
            disabled={adding || !selectedUserId}
            className={adminPrimaryButtonClass}
          >
            {adding ? "Adding..." : "Add admin"}
          </button>
        </div>
      </div>
      <ul className="mt-4 space-y-3">
        {admins.map((a) => (
          <li
            key={a.user_id}
            className="grid gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 shadow-sm md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
          >
            <div className="min-w-0">
              <p className="truncate font-medium text-zinc-900">
                {a.first_name} {a.last_name}
              </p>
              <p className="truncate text-sm text-zinc-500">{a.email}</p>
            </div>
            <button
              type="button"
              onClick={() => handleRemove(a.user_id)}
              className={adminDestructiveButtonSmClass}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
