"use client";

import { useEffect, useMemo, useRef } from "react";
import { getRichTextEditorValue, sanitizeRichTextHtml } from "@/lib/rich-text";

function ToolbarButton({
  label,
  title,
  onClick,
}: {
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      title={title}
      className="rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
    >
      {label}
    </button>
  );
}

export function RichTextEditor({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string | null;
  onChange: (value: string) => void;
  hint?: string;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const normalizedValue = useMemo(() => getRichTextEditorValue(value), [value]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (editor.innerHTML !== normalizedValue) {
      editor.innerHTML = normalizedValue;
    }
  }, [normalizedValue]);

  function syncValue() {
    const editor = editorRef.current;
    if (!editor) return;
    onChange(sanitizeRichTextHtml(editor.innerHTML) ?? "");
  }

  function runCommand(command: string, valueArg?: string) {
    editorRef.current?.focus();
    document.execCommand(command, false, valueArg);
    syncValue();
    editorRef.current?.focus();
  }

  function handleLink() {
    const url = window.prompt("Enter a link URL", "https://");
    if (!url) return;
    runCommand("createLink", url);
  }

  return (
    <div>
      <label className="block text-sm font-medium text-zinc-700">{label}</label>
      <div className="mt-1 rounded-lg border border-zinc-300 bg-white">
        <div className="flex flex-wrap gap-2 border-b border-zinc-200 px-3 py-2">
          <ToolbarButton label="B" title="Bold" onClick={() => runCommand("bold")} />
          <ToolbarButton label="I" title="Italic" onClick={() => runCommand("italic")} />
          <ToolbarButton label="U" title="Underline" onClick={() => runCommand("underline")} />
          <ToolbarButton label="Bullets" title="Bullet list" onClick={() => runCommand("insertUnorderedList")} />
          <ToolbarButton label="Numbers" title="Numbered list" onClick={() => runCommand("insertOrderedList")} />
          <ToolbarButton label="Link" title="Insert link" onClick={handleLink} />
          <ToolbarButton label="Clear" title="Clear formatting" onClick={() => runCommand("removeFormat")} />
        </div>
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={syncValue}
          className="min-h-32 w-full px-3 py-3 text-sm text-zinc-900 focus:outline-none [&_a]:text-[var(--wsu-crimson)] [&_a]:underline [&_li]:my-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-6"
        />
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        {hint ?? "Supports links, emphasis, and lists. Pasted content is reduced to safe basic formatting."}
      </p>
    </div>
  );
}
