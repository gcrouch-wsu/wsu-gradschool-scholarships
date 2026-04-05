import { Buffer } from "node:buffer";
import FormData from "form-data";
import { PassThrough, Readable, type Readable as NodeReadable } from "node:stream";

/**
 * Smartsheet API proxy - server-side only.
 * Token never exposed to client.
 * Per handoff: 30s write timeout default.
 */
const BASE_URL = "https://api.smartsheet.com/2.0";

export interface SmartsheetColumn {
  id: number;
  index: number;
  title: string;
  type: string;
  options?: string[];
  locked?: boolean;
}

export interface SmartsheetSheet {
  id: number;
  name: string;
  columns: SmartsheetColumn[];
}

export async function testConnection(token: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${BASE_URL}/users/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: body || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

const DEFAULT_WRITE_TIMEOUT_MS = 30000;

function parseSmartsheetError(body: string, httpStatus: number): { message: string; errorCode?: number; httpStatus: number } {
  try {
    const parsed = JSON.parse(body) as { errorCode?: number; message?: string };
    return {
      message: parsed.message ?? (body || `HTTP ${httpStatus}`),
      errorCode: parsed.errorCode,
      httpStatus,
    };
  } catch {
    return { message: body || `HTTP ${httpStatus}`, httpStatus };
  }
}

export async function getSheetRows(
  token: string,
  sheetId: number
): Promise<{
  ok: boolean;
  rows?: Array<{ id: number; cells: Record<number, unknown> }>;
  error?: string;
}> {
  try {
    const res = await fetch(`${BASE_URL}/sheets/${sheetId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: body || `HTTP ${res.status}` };
    }
    const data = (await res.json()) as {
      rows?: Array<{
        id: number;
        cells: Array<{ columnId: number; value?: unknown }>;
      }>;
    };
    const rows = (data.rows ?? []).map((row) => {
      const cells: Record<number, unknown> = {};
      for (const c of row.cells ?? []) {
        cells[c.columnId] = c.value;
      }
      return { id: row.id, cells };
    });
    return { ok: true, rows };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export async function updateRowCells(
  token: string,
  sheetId: number,
  rowId: number,
  cells: Array<{ columnId: number; value: unknown; strict?: boolean }>,
  timeoutMs?: number
): Promise<{ ok: boolean; error?: string; httpStatus?: number; errorCode?: number }> {
  const ms = timeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS;
  // Coerce null → "" — Smartsheet rejects explicit JSON null on any cell value
  const safeCells = cells.map((c) => ({
    columnId: c.columnId,
    value: c.value === null ? "" : c.value,
    ...(typeof c.strict === "boolean" ? { strict: c.strict } : {}),
  }));
  try {
    const res = await fetch(`${BASE_URL}/sheets/${sheetId}/rows`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([{ id: rowId, cells: safeCells }]),
      signal: AbortSignal.timeout(ms),
    });
    if (!res.ok) {
      const body = await res.text();
      const parsed = parseSmartsheetError(body, res.status);
      return { ok: false, error: parsed.message, httpStatus: parsed.httpStatus, errorCode: parsed.errorCode };
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export async function addRow(
  token: string,
  sheetId: number,
  cells: Array<{ columnId: number; value: unknown; strict?: boolean }>,
  timeoutMs?: number
): Promise<{ ok: boolean; rowId?: number; error?: string; httpStatus?: number; errorCode?: number }> {
  const ms = timeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS;
  // Coerce null → "" — Smartsheet rejects explicit JSON null on any cell value
  const safeCells = cells.map((c) => ({
    columnId: c.columnId,
    value: c.value === null ? "" : c.value,
    ...(typeof c.strict === "boolean" ? { strict: c.strict } : {}),
  }));
  try {
    const res = await fetch(`${BASE_URL}/sheets/${sheetId}/rows`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([{ cells: safeCells }]),
      signal: AbortSignal.timeout(ms),
    });
    const body = await res.text();
    if (!res.ok) {
      const parsed = parseSmartsheetError(body, res.status);
      return { ok: false, error: parsed.message, httpStatus: parsed.httpStatus, errorCode: parsed.errorCode };
    }
    const data = JSON.parse(body) as {
      result?: Array<{ id: number }>;
    };
    const rowId = data.result?.[0]?.id;
    return { ok: true, rowId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export async function getSheetSchema(
  token: string,
  sheetId: number
): Promise<{ ok: boolean; sheet?: SmartsheetSheet; error?: string }> {
  try {
    const res = await fetch(`${BASE_URL}/sheets/${sheetId}?include=columnType,columnOptions`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: body || `HTTP ${res.status}` };
    }
    const data = (await res.json()) as {
      id: number;
      name: string;
      columns: Array<{
        id: number;
        index: number;
        title: string;
        type?: string;
        columnType?: string;
        options?: string[];
        locked?: boolean;
      }>;
    };
    const columns = (data.columns ?? []).map((c) => {
      const colType = c.type ?? c.columnType;
      return {
        id: c.id,
        index: c.index,
        title: c.title,
        type: typeof colType === "string" && colType ? colType : "TEXT_NUMBER",
        options: c.options,
        locked: c.locked,
      };
    });
    return {
      ok: true,
      sheet: {
        id: data.id,
        name: data.name,
        columns,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export interface SmartsheetAttachment {
  id: number;
  name: string;
  url?: string;
  urlExpiresInMillis?: number;
  mimeType?: string;
  /** Smartsheet returns size in KB — used for dedup vs our size_bytes */
  sizeInKb?: number;
}

const ATTACHMENT_PAGE_SIZE = 100;

/**
 * List all row attachments (handles API pagination).
 */
export async function getRowAttachments(
  token: string,
  sheetId: number,
  rowId: number
): Promise<{ ok: boolean; attachments?: SmartsheetAttachment[]; error?: string; httpStatus?: number }> {
  try {
    const all: SmartsheetAttachment[] = [];
    let page = 1;

    while (page <= 200) {
      const res = await fetch(
        `${BASE_URL}/sheets/${sheetId}/rows/${rowId}/attachments?page=${page}&pageSize=${ATTACHMENT_PAGE_SIZE}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(20000),
        }
      );
      if (!res.ok) {
        const body = await res.text();
        return { ok: false, error: body || `HTTP ${res.status}`, httpStatus: res.status };
      }
      const data = (await res.json()) as {
        data?: Array<{
          id: number;
          name: string;
          url?: string;
          urlExpiresInMillis?: number;
          mimeType?: string;
          sizeInKb?: number;
        }>;
      };
      const chunk = data.data ?? [];
      for (const a of chunk) {
        all.push({
          id: a.id,
          name: a.name,
          url: a.url,
          urlExpiresInMillis: a.urlExpiresInMillis,
          mimeType: a.mimeType,
          sizeInKb: a.sizeInKb,
        });
      }
      if (chunk.length === 0 || chunk.length < ATTACHMENT_PAGE_SIZE) break;
      page += 1;
    }

    return { ok: true, attachments: all };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export interface AttachFileResult {
  ok: true;
  attachmentId: number;
}

export interface AttachFileError {
  ok: false;
  error: string;
  httpStatus?: number;
  errorCode?: number;
}

/**
 * Content-Disposition for Smartsheet "simple" upload (raw body, not multipart).
 * @see https://developers.smartsheet.com/api/smartsheet/openapi/attachments — Simple uploads
 */
function smartsheetSimpleUploadContentDisposition(filename: string): string {
  const trimmed = filename.trim() || "file";
  const asciiSafe = /^[\x20-\x7E]*$/.test(trimmed);
  if (asciiSafe) {
    const escaped = trimmed.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `attachment; filename="${escaped}"`;
  }
  const fallback =
    trimmed.replace(/[^\x20-\x7E]+/g, "_").replace(/["\\]/g, "_") || "file";
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(trimmed)}`;
}

/**
 * Simple (non-multipart) file upload to a row — same endpoint as multipart, avoids boundary / chunked issues.
 * Request body is the raw file bytes; Content-Length is implied by a fixed Uint8Array body.
 */
export async function attachFileToRowSimple(
  token: string,
  sheetId: number,
  rowId: number,
  filename: string,
  contentType: string,
  fileBytes: Uint8Array,
  timeoutMs?: number
): Promise<AttachFileResult | AttachFileError> {
  const ms = timeoutMs ?? 120_000;
  try {
    const ct =
      typeof contentType === "string" && contentType.trim() !== ""
        ? contentType.trim()
        : "application/octet-stream";

    // Blob is well-typed as BodyInit; type sets the request Content-Type for this raw-body upload.
    const res = await fetch(`${BASE_URL}/sheets/${sheetId}/rows/${rowId}/attachments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Disposition": smartsheetSimpleUploadContentDisposition(filename),
      },
      body: new Blob([Buffer.from(fileBytes)], { type: ct }),
      signal: AbortSignal.timeout(ms),
    });

    const body = await res.text();
    if (!res.ok) {
      const parsed = parseSmartsheetError(body, res.status);
      return {
        ok: false,
        error: parsed.message,
        httpStatus: parsed.httpStatus,
        errorCode: parsed.errorCode,
      };
    }

    return parseAttachResponseBody(body, res.status);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

function parseAttachResponseBody(body: string, httpStatus: number): AttachFileResult | AttachFileError {
  let attachmentId: number | undefined;
  try {
    const data = JSON.parse(body) as { result?: { id?: number }; id?: number };
    attachmentId = data.result?.id ?? data.id;
  } catch {
    return { ok: false, error: "Invalid Smartsheet attach response", httpStatus };
  }

  if (typeof attachmentId !== "number" || !Number.isFinite(attachmentId)) {
    return { ok: false, error: "Smartsheet attach response missing attachment id", httpStatus };
  }

  return { ok: true, attachmentId };
}

/**
 * Download URL for an existing FILE attachment (time-limited; use immediately).
 */
export async function getAttachmentDownloadMeta(
  token: string,
  sheetId: number,
  attachmentId: number
): Promise<
  { ok: true; url: string; name?: string } | { ok: false; error: string; httpStatus?: number }
> {
  try {
    const res = await fetch(`${BASE_URL}/sheets/${sheetId}/attachments/${attachmentId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(60_000),
    });
    const body = await res.text();
    if (!res.ok) {
      return { ok: false, error: body || `HTTP ${res.status}`, httpStatus: res.status };
    }
    let data: { url?: string; name?: string; result?: { url?: string; name?: string } };
    try {
      data = JSON.parse(body) as typeof data;
    } catch {
      return { ok: false, error: "Invalid Smartsheet attachment JSON", httpStatus: res.status };
    }
    const url = data.result?.url ?? data.url;
    const name = data.result?.name ?? data.name;
    if (typeof url !== "string" || !url) {
      return { ok: false, error: "Attachment response missing url", httpStatus: res.status };
    }
    return { ok: true, url, name };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

/**
 * Content-Type from form-data must be sent verbatim (boundary matches the streamed/buffered body).
 * Native fetch must not receive the form-data instance as `body` — undici mishandles it.
 */
function multipartContentTypeFromFormData(form: FormData): string {
  const raw = form.getHeaders()["content-type"];
  if (typeof raw !== "string" || !raw.includes("multipart/form-data")) {
    throw new Error("form-data did not produce a multipart Content-Type header");
  }
  return raw;
}

/**
 * Upload a native FILE attachment to a Smartsheet row (multipart), streaming body.
 */
export async function attachFileToRowFromReadable(
  token: string,
  sheetId: number,
  rowId: number,
  filename: string,
  contentType: string,
  stream: NodeReadable,
  timeoutMs?: number
): Promise<AttachFileResult | AttachFileError> {
  const ms = timeoutMs ?? 120_000;
  try {
    const form = new FormData();
    // Smartsheet requires the part name to be exactly "file"
    form.append("file", stream, {
      filename,
      contentType,
    });

    const contentTypeHeader = multipartContentTypeFromFormData(form);
    // Pipe legacy form-data stream → PassThrough → Web ReadableStream so undici/fetch
    // sends the exact multipart bytes (and does not replace Content-Type / boundary).
    const pass = new PassThrough();
    form.once("error", (err) => {
      pass.destroy(err);
    });
    form.pipe(pass);
    const body = Readable.toWeb(pass);

    const res = await fetch(`${BASE_URL}/sheets/${sheetId}/rows/${rowId}/attachments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": contentTypeHeader,
      },
      body,
      duplex: "half",
      signal: AbortSignal.timeout(ms),
    } as RequestInit & { duplex: "half" });

    const bodyText = await res.text();
    if (!res.ok) {
      const parsed = parseSmartsheetError(bodyText, res.status);
      return {
        ok: false,
        error: parsed.message,
        httpStatus: parsed.httpStatus,
        errorCode: parsed.errorCode,
      };
    }

    return parseAttachResponseBody(bodyText, res.status);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

/**
 * Upload a native FILE attachment to a Smartsheet row (multipart).
 */
export async function attachFileToRow(
  token: string,
  sheetId: number,
  rowId: number,
  filename: string,
  contentType: string,
  fileBytes: Uint8Array,
  timeoutMs?: number
): Promise<AttachFileResult | AttachFileError> {
  const ms = timeoutMs ?? 120_000;
  try {
    const form = new FormData();
    // Use Buffer for compatibility with form-data package; name part "file"
    form.append("file", Buffer.from(fileBytes), {
      filename,
      contentType,
    });

    const contentTypeHeader = multipartContentTypeFromFormData(form);
    // Buffer satisfies fetch at runtime; narrow to Uint8Array for TS BodyInit
    const payload = new Uint8Array(form.getBuffer());

    const res = await fetch(`${BASE_URL}/sheets/${sheetId}/rows/${rowId}/attachments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": contentTypeHeader,
      },
      body: payload,
      signal: AbortSignal.timeout(ms),
    });

    const body = await res.text();
    if (!res.ok) {
      const parsed = parseSmartsheetError(body, res.status);
      return {
        ok: false,
        error: parsed.message,
        httpStatus: parsed.httpStatus,
        errorCode: parsed.errorCode,
      };
    }

    return parseAttachResponseBody(body, res.status);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

/** True if Smartsheet attachment size (sizeInKb) matches our byte size within ~1 KiB */
export function smartsheetAttachmentMatchesSize(
  sizeInKb: number | undefined,
  sizeBytes: number
): boolean {
  if (typeof sizeInKb !== "number" || !Number.isFinite(sizeInKb)) return true;
  const fromSheet = Math.round(sizeInKb * 1024);
  return Math.abs(fromSheet - sizeBytes) <= 1024;
}
