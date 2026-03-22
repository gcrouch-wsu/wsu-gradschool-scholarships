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
}

export async function getRowAttachments(
  token: string,
  sheetId: number,
  rowId: number
): Promise<{ ok: boolean; attachments?: SmartsheetAttachment[]; error?: string }> {
  try {
    const res = await fetch(
      `${BASE_URL}/sheets/${sheetId}/rows/${rowId}/attachments`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      }
    );
    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: body || `HTTP ${res.status}` };
    }
    const data = (await res.json()) as {
      data?: Array<{
        id: number;
        name: string;
        url?: string;
        urlExpiresInMillis?: number;
        mimeType?: string;
      }>;
    };
    const attachments = (data.data ?? []).map((a) => ({
      id: a.id,
      name: a.name,
      url: a.url,
      urlExpiresInMillis: a.urlExpiresInMillis,
      mimeType: a.mimeType,
    }));
    return { ok: true, attachments };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}
