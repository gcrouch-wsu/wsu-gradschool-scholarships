"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function NewProgramForm() {
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function slugFromName() {
    return name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/programs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: slug.trim() || slugFromName(),
          name: name.trim(),
          description: description.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create program");
        return;
      }
      router.push(`/admin/scholarships/${data.id}`);
      router.refresh();
    } catch {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-zinc-900">
        New scholarship program
      </h1>
      <form onSubmit={handleSubmit} className="max-w-md space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-zinc-700">
            Name
          </label>
          <input
            id="name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slug) setSlug(slugFromName());
            }}
            required
            className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="slug" className="block text-sm font-medium text-zinc-700">
            Slug
          </label>
          <input
            id="slug"
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder={slugFromName() || "e.g. gdapp"}
            className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-zinc-500">
            Lowercase letters, numbers, hyphens only
          </p>
        </div>
        <div>
          <label htmlFor="description" className="block text-sm font-medium text-zinc-700">
            Description (optional)
          </label>
          <textarea
            id="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="mt-1 block w-full rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
          >
            {loading ? "Creating…" : "Create program"}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
