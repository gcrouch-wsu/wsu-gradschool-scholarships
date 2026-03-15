"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PublishConfigButton({
  cycleId,
  latestVersion,
  publishedVersionId,
}: {
  cycleId: string;
  latestVersion: { id: string; version_number: number } | null;
  publishedVersionId: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (!latestVersion) return null;

  const isPublished = publishedVersionId === latestVersion.id;

  async function handlePublish() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/cycles/${cycleId}/publish-config`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Publish failed");
        return;
      }
      router.refresh();
    } catch {
      setError("An error occurred");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2" title="Each save creates a new version. Publish makes this version live for reviewers.">
      {isPublished ? (
        <span className="text-sm text-green-600">
          Published (v{latestVersion.version_number})
        </span>
      ) : (
        <>
          <button
            type="button"
            onClick={handlePublish}
            disabled={loading}
            className="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50 disabled:opacity-50"
            title="Each save creates a new version. Publish makes this version live for reviewers."
          >
            {loading ? "Publishing…" : `Publish latest (v${latestVersion.version_number})`}
          </button>
          {error && <span className="text-sm text-red-600">{error}</span>}
        </>
      )}
    </div>
  );
}
