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
import {
  formatIntakeSchemaUnavailableMessage,
  getIntakeSchemaStatus,
} from "@/lib/intake-schema";

export const runtime = "nodejs";

interface AttachmentExportFileRow {
  id: string;
  submission_id: string;
  original_filename: string;
  blob_pathname: string;
  field_key: string;
  size_bytes: number;
  created_at: string;
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
    `SELECT id, submission_id, original_filename, blob_pathname, field_key, size_bytes, created_at
     FROM intake_submission_files
     WHERE cycle_id = $1
     ORDER BY submission_id, field_key, created_at, id`,
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

    for (const file of files) {
      try {
        const blobResult = await get(file.blob_pathname, {
          access: "private",
          token: process.env.BLOB_READ_WRITE_TOKEN,
          useCache: false,
        });

        if (!blobResult) {
          throw new Error("Blob not found");
        }

        const blobStream = toNodeReadableStream(blobResult.stream);
        if (blobResult.statusCode !== 200 || !blobStream) {
          throw new Error("Blob not found");
        }

        zip.file(buildAttachmentExportZipPath(file), blobStream, {
          binary: true,
        });
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
