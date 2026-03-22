const ALLOWED_TAG_PATTERN = /^(p|br|strong|em|u|ul|ol|li|a)$/i;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function stripDisallowedTags(value: string): string {
  return value.replace(/<\/?([a-z0-9-]+)\b[^>]*>/gi, (match, tagName: string) => {
    if (ALLOWED_TAG_PATTERN.test(tagName)) {
      return match;
    }
    return "";
  });
}

function normalizePlainTextToHtml(value: string): string {
  return value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br />")}</p>`)
    .join("");
}

export function sanitizeRichTextHtml(value: string | null | undefined): string | null {
  const input = typeof value === "string" ? value.trim() : "";
  if (!input) return null;

  const hasHtml = /<[a-z][\s\S]*>/i.test(input);
  if (!hasHtml) {
    return normalizePlainTextToHtml(input) || null;
  }

  let sanitized = input
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\son\w+=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/\s(?:style|class|id|data-[\w-]+|contenteditable)=(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  sanitized = stripDisallowedTags(sanitized);

  sanitized = sanitized
    .replace(/<a\b([^>]*)href=(["']?)([^"'>\s]+)\2([^>]*)>/gi, (_match, _before, _quote, href) => {
      const safeHref = String(href).trim();
      if (!/^(https?:\/\/|mailto:|\/)/i.test(safeHref)) {
        return "<a>";
      }
      return `<a href="${escapeAttribute(safeHref)}" target="_blank" rel="noopener noreferrer">`;
    })
    .replace(/<a\b(?![^>]*href=)[^>]*>/gi, "<a>");

  return sanitized.trim() || null;
}

export function getRichTextEditorValue(value: string | null | undefined): string {
  return sanitizeRichTextHtml(value) ?? "";
}
