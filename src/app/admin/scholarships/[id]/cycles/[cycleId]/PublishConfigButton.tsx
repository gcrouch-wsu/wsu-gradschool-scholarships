"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PublishConfigButton({
  cycleId,
  latestConfigId,
  publishedConfigId,
  publishedAt,
}: {
  cycleId: string;
  latestConfigId: string | null;
  publishedConfigId: string | null;
  publishedAt: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [unpublishLoading, setUnpublishLoading] = useState(false);
  const [error, setError] = useState("");

  if (!latestConfigId) return null;

  const isPublished = !!publishedConfigId;
  const isLatestPublished = publishedConfigId === latestConfigId;

  async function handlePublish() {
    if (!confirm("Publish this configuration? Reviewers will see the updated fields and layout.")) return;
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

  async function handleUnpublish() {
    if (!confirm("Unpublish this configuration? Reviewers will not see any config until you publish again.")) return;
    setError("");
    setUnpublishLoading(true);
    try {
      const res = await fetch(`/api/admin/cycles/${cycleId}/unpublish-config`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Unpublish failed");
        return;
      }
      router.refresh();
    } catch {
      setError("An error occurred");
    } finally {
      setUnpublishLoading(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {isPublished ? (
        <>
          <span className="text-sm font-medium text-green-700">
            Published{publishedAt ? ` — ${new Date(publishedAt).toLocaleString()}` : ""}
          </span>
          {!isLatestPublished && (
            <span className="text-xs text-amber-600">(unsaved changes in builder)</span>
          )}
          <button
            type="button"
            onClick={handleUnpublish}
            disabled={unpublishLoading}
            className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-50 disabled:opacity-50"
            title="Remove published config. Reviewers will see nothing until you publish again."
          >
            {unpublishLoading ? "…" : "Unpublish"}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={handlePublish}
          disabled={loading}
          className="rounded-md bg-[var(--wsu-crimson)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--wsu-crimson-hover)] disabled:opacity-50"
          title="Publish makes this config live for reviewers."
        >
          {loading ? "Publishing…" : "Publish to reviewers"}
        </button>
      )}
      {error && <span className="text-sm text-red-600">{error}</span>}
    </div>
  );
}
