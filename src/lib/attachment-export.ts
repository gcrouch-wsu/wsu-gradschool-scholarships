export interface AttachmentExportRecord {
  id: string;
  submission_id: string;
  field_key: string;
  original_filename: string;
}

const PATH_UNSAFE_CHARS = /[<>:"/\\|?*\u0000-\u001F]+/g;
const WHITESPACE_RUN = /\s+/g;
const LEADING_DOTS = /^\.+/;
const TRAILING_DOTS = /\.+$/;

function normalizeSegment(value: string): string {
  return value
    .normalize("NFKD")
    .replace(PATH_UNSAFE_CHARS, "_")
    .replace(WHITESPACE_RUN, " ")
    .trim()
    .replace(LEADING_DOTS, "")
    .replace(TRAILING_DOTS, "");
}

export function sanitizeZipPathSegment(value: string, fallback: string): string {
  const normalized = normalizeSegment(value);
  return normalized || fallback;
}

export function sanitizeZipFilename(value: string, fallback = "attachment.pdf"): string {
  const sanitized = sanitizeZipPathSegment(value, fallback);
  if (/\.[A-Za-z0-9]{1,10}$/.test(sanitized)) {
    return sanitized;
  }
  return `${sanitized}.pdf`;
}

export function buildAttachmentExportZipPath(file: AttachmentExportRecord): string {
  const submissionSegment = sanitizeZipPathSegment(
    `submission-${file.submission_id.slice(0, 8)}`,
    "submission"
  );
  const fieldSegment = sanitizeZipPathSegment(file.field_key, "attachment");
  const filename = sanitizeZipFilename(file.original_filename);
  const uniquePrefix = sanitizeZipPathSegment(file.id.slice(0, 8), "file");

  return `${submissionSegment}/${fieldSegment}/${uniquePrefix}-${filename}`;
}

export function buildAttachmentExportDownloadName(cycleId: string, date = new Date()): string {
  return `attachments-cycle-${cycleId.slice(0, 8)}-${date.toISOString().slice(0, 10)}.zip`;
}

export function buildAttachmentExportErrorsManifest(errors: string[]): string {
  const lines = [
    "Some files could not be included in this export.",
    "",
    ...errors,
    "",
    `Generated at: ${new Date().toISOString()}`,
  ];

  return `${lines.join("\n")}\n`;
}
