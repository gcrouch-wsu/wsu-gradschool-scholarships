"use client";

import { useState } from "react";

export function TestButton({ connectionId }: { connectionId: string }) {
  const [status, setStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [error, setError] = useState("");

  async function handleTest() {
    setStatus("testing");
    setError("");
    try {
      const res = await fetch(`/api/admin/connections/${connectionId}/test`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.ok) {
        setStatus("ok");
      } else {
        setStatus("fail");
        setError(data.error ?? "Connection failed");
      }
    } catch {
      setStatus("fail");
      setError("Request failed");
    }
  }

  return (
    <div className="flex items-center gap-2">
      {status === "ok" && (
        <span className="text-sm text-green-600">OK</span>
      )}
      {status === "fail" && (
        <span className="text-sm text-red-600" title={error}>
          Failed
        </span>
      )}
      <button
        type="button"
        onClick={handleTest}
        disabled={status === "testing"}
        className="rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50 disabled:opacity-50"
      >
        {status === "testing" ? "Testing…" : "Test"}
      </button>
    </div>
  );
}
