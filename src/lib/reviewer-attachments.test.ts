import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildReviewerAttachmentBlobPath,
  createSignedReviewerFileUrl,
  getReviewerAttachmentSchemaStatus,
  verifySignedReviewerFileUrl,
} from "./reviewer-attachments";

const { queryMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
}));

vi.mock("./db", () => ({
  query: queryMock,
}));

describe("reviewer attachment helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENCRYPTION_KEY = "test-key-32-chars-long-exactly-32";
    queryMock.mockResolvedValue({ rows: [{ available: true }] });
  });

  it("builds a stable blob pathname for reviewer uploads", () => {
    expect(
      buildReviewerAttachmentBlobPath(
        "cycle-1",
        123,
        "user-1",
        "Faculty Support Letter (Final).pdf",
        "upload 1"
      )
    ).toBe(
      "reviewer-attachments/cycle-1/123/user-1/upload-1-Faculty-Support-Letter-Final.pdf"
    );
  });

  it("creates and verifies signed reviewer file URLs", () => {
    const expiresAt = Date.now() + 60_000;
    const url = createSignedReviewerFileUrl("file-1", expiresAt);
    const parsed = new URL(`https://example.test${url}`);
    const signature = parsed.searchParams.get("signature") || "";
    const expires = Number(parsed.searchParams.get("expires"));

    expect(verifySignedReviewerFileUrl("file-1", expires, signature)).toBe(true);
    expect(verifySignedReviewerFileUrl("file-2", expires, signature)).toBe(false);
  });

  it("checks whether the reviewer attachment schema is available", async () => {
    const result = await getReviewerAttachmentSchemaStatus();
    expect(result.available).toBe(true);
    expect(queryMock).toHaveBeenCalledWith(
      "SELECT to_regclass('public.reviewer_row_files') IS NOT NULL AS available"
    );
  });
});
