/**
 * Best-effort redaction before persisting Smartsheet (or other) error text in sync_error_json.
 */
export function sanitizeSyncErrorForStorage(message: string): string {
  let s = message.replace(/\r\n/g, "\n");
  s = s.replace(/Bearer\s+[\w\-._~+/]+=*/gi, "Bearer [redacted]");
  s = s.replace(/Authorization\s*:\s*[^\s]+/gi, "Authorization: [redacted]");
  s = s.replace(/api[_-]?key\s*[=:]\s*\S+/gi, "api_key=[redacted]");
  if (s.length > 4000) {
    return `${s.slice(0, 4000)}…`;
  }
  return s;
}
