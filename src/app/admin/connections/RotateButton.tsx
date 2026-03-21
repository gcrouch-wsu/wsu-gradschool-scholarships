"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RotateButton({
  connectionId,
  connectionName,
}: {
  connectionId: string;
  connectionName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<"idle" | "rotating" | "ok" | "fail">("idle");
  const [error, setError] = useState("");

  async function handleRotate() {
    if (!token.trim()) return;
    setStatus("rotating");
    setError("");
    try {
      const res = await fetch(`/api/admin/connections/${connectionId}/rotate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setStatus("ok");
        setToken("");
        setOpen(false);
        router.refresh();
      } else {
        setStatus("fail");
        setError(data.error ?? "Rotation failed");
      }
    } catch {
      setStatus("fail");
      setError("Request failed");
    }
  }

  return (
    <div className="flex items-center gap-2">
      {open ? (
        <div className="flex flex-col gap-2 rounded border border-zinc-200 bg-zinc-50 p-3">
          <p className="text-xs text-zinc-600">
            Enter new Smartsheet API token for {connectionName}. It will be verified before saving.
          </p>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="New token"
            className="rounded-md border border-zinc-300 px-2 py-1 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
          />
          {error && <span className="text-xs text-red-600">{error}</span>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleRotate}
              disabled={status === "rotating" || !token.trim()}
              className="rounded-md bg-[var(--wsu-crimson)] px-2 py-1 text-xs text-white hover:bg-[var(--wsu-crimson-hover)] disabled:opacity-50"
            >
              {status === "rotating" ? "Rotating…" : "Rotate"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setToken("");
                setError("");
              }}
              className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded border border-amber-300 px-3 py-1 text-sm text-amber-800 hover:bg-amber-50"
        >
          Rotate token
        </button>
      )}
    </div>
  );
}
