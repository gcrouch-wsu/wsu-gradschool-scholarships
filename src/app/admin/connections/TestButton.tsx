"use client";

import { useState } from "react";
import { adminSecondaryButtonSmClass } from "@/components/admin/actionStyles";

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
        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">OK</span>
      )}
      {status === "fail" && (
        <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700" title={error}>
          Failed
        </span>
      )}
      <button
        type="button"
        onClick={handleTest}
        disabled={status === "testing"}
        className={adminSecondaryButtonSmClass}
      >
        {status === "testing" ? "Testing…" : "Test"}
      </button>
    </div>
  );
}
