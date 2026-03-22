import { NextRequest, NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { query } from "@/lib/db";
import {
  getReviewerAttachmentSchemaStatus,
  verifySignedReviewerFileUrl,
} from "@/lib/reviewer-attachments";

export const runtime = "nodejs";

function toSafeFilename(filename: string): string {
  return filename.replace(/["\r\n]+/g, "_");
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const schema = await getReviewerAttachmentSchemaStatus();
  if (!schema.available) {
    return NextResponse.json({ error: "Reviewer attachments are unavailable" }, { status: 503 });
  }

  const { fileId } = await params;
  const expires = Number(request.nextUrl.searchParams.get("expires"));
  const signature = request.nextUrl.searchParams.get("signature") || "";

  if (!verifySignedReviewerFileUrl(fileId, expires, signature)) {
    return NextResponse.json({ error: "Invalid or expired file link" }, { status: 401 });
  }

  const { rows } = await query<{
    blob_pathname: string;
    original_filename: string;
    content_type: string;
  }>(
    "SELECT blob_pathname, original_filename, content_type FROM reviewer_row_files WHERE id = $1",
    [fileId]
  );
  const file = rows[0];
  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const blobResult = await get(file.blob_pathname, {
    access: "private",
    token: process.env.BLOB_READ_WRITE_TOKEN,
    useCache: false,
  });

  if (!blobResult || blobResult.statusCode !== 200 || !blobResult.stream) {
    return NextResponse.json({ error: "Blob not found" }, { status: 404 });
  }

  return new NextResponse(blobResult.stream as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": file.content_type || blobResult.blob.contentType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${toSafeFilename(file.original_filename)}"`,
      "Cache-Control": "private, max-age=60",
    },
  });
}
