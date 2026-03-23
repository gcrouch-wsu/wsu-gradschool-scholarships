"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { adminPrimaryButtonClass } from "@/components/admin/actionStyles";

export function CreateConnectionForm({
  programs,
}: {
  programs: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [programId, setProgramId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          token: token.trim(),
          programId: programId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create connection");
        return;
      }
      setName("");
      setToken("");
      setProgramId("");
      router.refresh();
    } catch {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-md space-y-4 rounded-lg border border-zinc-200 bg-white p-4"
    >
      <h2 className="font-medium text-zinc-900">Add connection</h2>
      <div>
        <label htmlFor="name" className="block text-sm font-medium text-zinc-700">
          Connection name
        </label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. WSU Grad School"
          required
          className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
        />
      </div>
      <div>
        <label htmlFor="token" className="block text-sm font-medium text-zinc-700">
          Smartsheet API token
        </label>
        <input
          id="token"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          required
          autoComplete="off"
          className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
        />
        <p className="mt-1 text-xs text-zinc-500">
          Token is encrypted and never shown again.
        </p>
      </div>
      <div>
        <label htmlFor="program" className="block text-sm font-medium text-zinc-700">
          Assign to program (optional)
        </label>
        <select
          id="program"
          value={programId}
          onChange={(e) => setProgramId(e.target.value)}
          className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
        >
          <option value="">— Unassigned (platform only) —</option>
          {programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-zinc-500">
          Scholarship admins can only use connections assigned to their program.
        </p>
      </div>
      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
      <button
        type="submit"
        disabled={loading}
        className={adminPrimaryButtonClass}
      >
        {loading ? "Adding…" : "Add connection"}
      </button>
    </form>
  );
}
