import { NextRequest, NextResponse } from "next/server";
import { get } from "@vercel/blob";
import JSZip from "jszip";
import { Readable } from "stream";
import type { ReadableStream as NodeWebReadableStream } from "stream/web";
import { getSessionUser } from "@/lib/auth";
import { canManageCycle } from "@/lib/admin";
import { query } from "@/lib/db";
import {
  buildAttachmentExportDownloadName,
  buildAttachmentExportErrorsManifest,
  buildAttachmentExportZipPath,
} from "@/lib/attachment-export";
import { decrypt } from "@/lib/encryption";
import { MAX_SMARTSHEET_MIRROR_FILE_BYTES } from "@/lib/intake";
import {
  formatIntakeSchemaUnavailableMessage,
  getIntakeSchemaStatus,
} from "@/lib/intake-schema";
import { webStreamToNodeReadableMaxBytes } from "@/lib/attachment-sync";
import { getAttachmentDownloadMeta } from "@/lib/smartsheet";

export const runtime = "nodejs";
/** Vercel Pro+: raise if your plan allows (Hobby max is lower). */
export const maxDuration = 60;

interface AttachmentExportFileRow {
  id: string;
  submission_id: string;
  original_filename: string;
  blob_pathname: string;
  field_key: string;
  size_bytes: number;
  created_at: string;
  blob_deleted_at: string | null;
  smartsheet_attachment_id: string | number | null;
  smartsheet_attachment_name: string | null;
  connection_id: string;
  sheet_id: string | number;
}

function toNodeReadableStream(stream: unknown): NodeJS.ReadableStream | null {
  if (!stream) return null;
  if (typeof stream === "object" && stream !== null && "pipe" in stream) {
    return stream as NodeJS.ReadableStream;
  }
  if (typeof stream === "object" && stream !== null && "getReader" in stream) {
    return Readable.fromWeb(stream as NodeWebReadableStream<Uint8Array>);
  }
  return null;
}

function parseSmartsheetAttachmentId(
  raw: string | number | null | undefined
): number | null {
  if (raw == null) return null;
  const n = typeof raw === "string" ? parseInt(raw, 10) : Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function getDecryptedToken(connectionId: string): Promise<string | null> {
  const { rows } = await query<{ encrypted_credentials: string }>(
    "SELECT encrypted_credentials FROM connections WHERE id = $1",
    [connectionId]
  );
  const enc = rows[0]?.encrypted_credentials;
  if (!enc) return null;
  try {
    return decrypt(enc);
  } catch {
    return null;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: cycleId } = await params;
  const canManage = await canManageCycle(user.id, user.is_platform_admin, cycleId);
  if (!canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const schemaStatus = await getIntakeSchemaStatus();
  if (!schemaStatus.available) {
    return NextResponse.json(
      { error: formatIntakeSchemaUnavailableMessage(schemaStatus.missingTables) },
      { status: 503 }
    );
  }

  const { rows: files } = await query<AttachmentExportFileRow>(
    `SELECT isf.id, isf.submission_id, isf.original_filename, isf.blob_pathname, isf.field_key,
            isf.size_bytes, isf.created_at, isf.blob_deleted_at, isf.smartsheet_attachment_id,
            isf.smartsheet_attachment_name, c.connection_id, c.sheet_id::bigint AS sheet_id
     FROM intake_submission_files isf
     INNER JOIN scholarship_cycles c ON c.id = isf.cycle_id
     WHERE isf.cycle_id = $1
       AND (isf.blob_deleted_at IS NULL OR isf.smartsheet_attachment_id IS NOT NULL)
     ORDER BY isf.submission_id, isf.field_key, isf.created_at, isf.id`,
    [cycleId]
  );

  if (files.length === 0) {
    return NextResponse.json({ error: "No attachments found for this cycle" }, { status: 404 });
  }

  if (request.nextUrl.searchParams.get("mode") === "check") {
    return NextResponse.json({
      fileCount: files.length,
      totalBytes: files.reduce((sum, file) => sum + Number(file.size_bytes || 0), 0),
    });
  }

  try {
    const zip = new JSZip();
    const errors: string[] = [];
    let includedCount = 0;
    const tokenByConnection = new Map<string, string>();

    for (const file of files) {
      try {
        const zipPath = buildAttachmentExportZipPath({
          id: file.id,
          submission_id: file.submission_id,
          field_key: file.field_key,
          original_filename: file.original_filename,
          display_filename: file.smartsheet_attachment_name,
        });

        let nodeStream: NodeJS.ReadableStream | null = null;

        const tryBlob = !file.blob_deleted_at;

        if (tryBlob) {
          const blobResult = await get(file.blob_pathname, {
            access: "private",
            token: process.env.BLOB_READ_WRITE_TOKEN,
            useCache: false,
          });

          if (blobResult && blobResult.statusCode === 200) {
            nodeStream = toNodeReadableStream(blobResult.stream);
          }
        }

        if (!nodeStream) {
          const attachmentId = parseSmartsheetAttachmentId(file.smartsheet_attachment_id);
          const sheetId =
            typeof file.sheet_id === "string"
              ? parseInt(file.sheet_id, 10)
              : Number(file.sheet_id);

          if (!Number.isFinite(sheetId) || attachmentId == null) {
            throw new Error(
              tryBlob
                ? "Blob unavailable and no Smartsheet attachment id for fallback"
                : "Blob was removed; Smartsheet attachment id missing"
            );
          }

          let token = tokenByConnection.get(file.connection_id);
          if (!token) {
            token = (await getDecryptedToken(file.connection_id)) ?? undefined;
            if (!token) {
              throw new Error("Could not load connection token for Smartsheet fallback");
            }
            tokenByConnection.set(file.connection_id, token);
          }

          const meta = await getAttachmentDownloadMeta(token, sheetId, attachmentId);
          if (!meta.ok) {
            throw new Error(meta.error || "Smartsheet attachment metadata failed");
          }

          const dl = await fetch(meta.url, { signal: AbortSignal.timeout(120_000) });
          if (!dl.ok) {
            throw new Error(`Smartsheet download HTTP ${dl.status}`);
          }
          if (!dl.body) {
            throw new Error("Smartsheet download had no body");
          }
          nodeStream = webStreamToNodeReadableMaxBytes(
            dl.body,
            MAX_SMARTSHEET_MIRROR_FILE_BYTES
          );
        }

        zip.file(zipPath, nodeStream, { binary: true });
        includedCount += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown export error";
        errors.push(
          `${file.original_filename} (${file.field_key}, ${file.submission_id.slice(0, 8)}): ${message}`
        );
      }
    }

    if (includedCount === 0) {
      return NextResponse.json(
        {
          error: "All attachment downloads failed before the ZIP could be created",
          details: errors,
        },
        { status: 502 }
      );
    }

    if (errors.length > 0) {
      zip.file("_EXPORT_ERRORS.txt", buildAttachmentExportErrorsManifest(errors));
    }

    const zipStream = zip.generateNodeStream({
      type: "nodebuffer",
      streamFiles: true,
      compression: "DEFLATE",
      compressionOptions: { level: 1 },
    });

    const headers = new Headers();
    headers.set("Content-Type", "application/zip");
    headers.set("Cache-Control", "private, no-store, max-age=0");
    headers.set(
      "Content-Disposition",
      `attachment; filename="${buildAttachmentExportDownloadName(cycleId)}"`
    );

    return new NextResponse(Readable.toWeb(zipStream as Readable) as ReadableStream, {
      status: 200,
      headers,
    });
  } catch (error) {
    console.error("Export attachments failed:", error);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
