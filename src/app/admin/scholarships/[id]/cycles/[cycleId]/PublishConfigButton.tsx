"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  adminPrimaryButtonClass,
  adminPrimaryButtonSmClass,
  adminSecondaryButtonSmClass,
} from "@/components/admin/actionStyles";

export function PublishConfigButton({
  cycleId,
  latestConfigId,
  publishedConfigId,
  publishedAt,
  showStatusText = true,
}: {
  cycleId: string;
  latestConfigId: string | null;
  publishedConfigId: string | null;
  publishedAt: string | null;
  showStatusText?: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [unpublishLoading, setUnpublishLoading] = useState(false);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);

  if (!latestConfigId) return null;

  const isPublished = !!publishedConfigId;
  const isLatestPublished = publishedConfigId === latestConfigId;

  async function handlePublish() {
    if (!confirm("Publish this configuration? Reviewers will see the updated fields and layout.")) return;
    setError("");
    setWarnings([]);
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
      if (data.warnings?.length) setWarnings(data.warnings);
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
          {showStatusText && (
            <span className="text-sm font-medium text-green-700">
              Published{publishedAt ? ` — ${new Date(publishedAt).toLocaleString()}` : ""}
            </span>
          )}
          {!isLatestPublished && (
            <>
              <span className="text-xs text-amber-600">(draft changes not published)</span>
              <button
                type="button"
                onClick={handlePublish}
                disabled={loading}
                className={adminPrimaryButtonSmClass}
                title="Publish the latest reviewer form changes."
              >
                {loading ? "Publishing…" : "Publish updates"}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={handleUnpublish}
            disabled={unpublishLoading}
            className={adminSecondaryButtonSmClass}
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
          className={adminPrimaryButtonClass}
          title="Publish makes this config live for reviewers."
        >
          {loading ? "Publishing…" : "Publish to reviewers"}
        </button>
      )}
      {error && <span className="text-sm text-red-600">{error}</span>}
      {warnings.length > 0 && (
        <div className="mt-2 w-full rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="font-medium">Published with warnings:</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
