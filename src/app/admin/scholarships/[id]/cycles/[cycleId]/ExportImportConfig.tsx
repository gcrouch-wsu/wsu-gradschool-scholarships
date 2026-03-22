"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

export function ExportImportConfig({
  cycleId,
  isPlatformAdmin,
}: {
  cycleId: string;
  isPlatformAdmin: boolean;
}) {
  const router = useRouter();
  const [exportLoading, setExportLoading] = useState(false);
  const [exportAttachmentsLoading, setExportAttachmentsLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [saveTemplateLoading, setSaveTemplateLoading] = useState(false);
  const [importError, setImportError] = useState("");
  const [templateName, setTemplateName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleExport() {
    setExportLoading(true);
    setImportError("");
    try {
      const res = await fetch(`/api/admin/cycles/${cycleId}/export-config`);
      if (!res.ok) {
        const data = await res.json();
        setImportError(data.error ?? "Export failed");
        return;
      }
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `cycle-config-${cycleId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setImportError("Export failed");
    } finally {
      setExportLoading(false);
    }
  }

  async function handleExportAttachments() {
    setExportAttachmentsLoading(true);
    setImportError("");
    try {
      const res = await fetch(`/api/admin/cycles/${cycleId}/export-attachments?mode=check`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const data = await res.json();
        setImportError(data.error ?? "Export failed");
        return;
      }
      const a = document.createElement("a");
      a.href = `/api/admin/cycles/${cycleId}/export-attachments`;
      a.rel = "noopener";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      setImportError("Export failed");
    } finally {
      setExportAttachmentsLoading(false);
    }
  }

  async function handleImport(file: File) {
    setImportLoading(true);
    setImportError("");
    try {
      const text = await file.text();
      const body = JSON.parse(text);
      const res = await fetch(`/api/admin/cycles/${cycleId}/import-config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setImportError(data.error ?? "Import failed");
        return;
      }
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    } catch (e) {
      setImportError(e instanceof SyntaxError ? "Invalid JSON file" : "Import failed");
    } finally {
      setImportLoading(false);
    }
  }

  async function handleSaveAsTemplate() {
    setSaveTemplateLoading(true);
    setImportError("");
    try {
      const res = await fetch(`/api/admin/cycles/${cycleId}/export-config`);
      if (!res.ok) {
        const data = await res.json();
        setImportError(data.error ?? "Export failed");
        return;
      }
      const data = await res.json();
      const name = templateName.trim() || `Template ${new Date().toISOString().slice(0, 10)}`;
      const config = {
        roles: data.roles,
        fieldConfigs: data.fieldConfigs,
        permissions: data.permissions,
        viewConfigs: data.viewConfigs,
      };
      const saveRes = await fetch("/api/admin/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, config }),
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok) {
        setImportError(saveData.error ?? "Save as template failed");
        return;
      }
      setTemplateName("");
      router.refresh();
    } catch {
      setImportError("Save as template failed");
    } finally {
      setSaveTemplateLoading(false);
    }
  }

  return (
    <div className="mt-4 rounded border border-zinc-200 bg-zinc-50 p-4">
      <h3 className="text-sm font-medium text-zinc-900">Export / Import config</h3>
      <p className="mt-1 text-xs text-zinc-600">
        Export cycle config as JSON or import from a previously exported file. Import replaces all
        roles, field mappings, and layout. Import works best when the target sheet has the same
        column structure as the source.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleExport}
          disabled={exportLoading}
          className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-white disabled:opacity-50"
        >
          {exportLoading ? "Exporting…" : "Export config"}
        </button>
        <button
          type="button"
          onClick={handleExportAttachments}
          disabled={exportAttachmentsLoading}
          className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-white disabled:opacity-50"
        >
          {exportAttachmentsLoading ? "Exporting…" : "Export attachments (ZIP)"}
        </button>
        <label className="cursor-pointer rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-white">
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            disabled={importLoading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f && confirm("Import will replace all current config. Continue?")) {
                handleImport(f);
              }
            }}
          />
          {importLoading ? "Importing…" : "Import config"}
        </label>
        {isPlatformAdmin && (
          <>
            <input
              type="text"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder="Template name"
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm focus:border-[var(--wsu-crimson)] focus:outline-none focus:ring-1 focus:ring-[var(--wsu-crimson)]"
            />
            <button
              type="button"
              onClick={handleSaveAsTemplate}
              disabled={saveTemplateLoading}
              className="rounded border border-zinc-300 px-3 py-1.5 text-sm hover:bg-white disabled:opacity-50"
            >
              {saveTemplateLoading ? "Saving…" : "Save as template"}
            </button>
          </>
        )}
        {importError && <span className="text-sm text-red-600">{importError}</span>}
      </div>
    </div>
  );
}
