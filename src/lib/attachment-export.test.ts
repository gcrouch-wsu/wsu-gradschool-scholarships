import { describe, expect, it } from "vitest";
import {
  buildAttachmentExportDownloadName,
  buildAttachmentExportErrorsManifest,
  buildAttachmentExportZipPath,
  sanitizeZipFilename,
  sanitizeZipPathSegment,
} from "./attachment-export";

describe("attachment export helpers", () => {
  it("sanitizes unsafe path characters", () => {
    expect(sanitizeZipPathSegment('Resume: Spring/2026', "fallback")).toBe("Resume_ Spring_2026");
    expect(sanitizeZipPathSegment("...", "fallback")).toBe("fallback");
  });

  it("normalizes filenames and preserves extensions", () => {
    expect(sanitizeZipFilename('my "resume".pdf')).toBe("my _resume_.pdf");
    expect(sanitizeZipFilename("transcript")).toBe("transcript.pdf");
  });

  it("builds collision-resistant zip paths", () => {
    expect(
      buildAttachmentExportZipPath({
        id: "f4d25217-1111-2222-3333-444444444444",
        submission_id: "b3be2d40-1111-2222-3333-444444444444",
        field_key: "resume_upload",
        original_filename: "resume.pdf",
      })
    ).toBe("submission-b3be2d40/resume_upload/f4d25217-resume.pdf");
  });

  it("builds stable download names", () => {
    expect(
      buildAttachmentExportDownloadName(
        "2b7a7f44-1111-2222-3333-444444444444",
        new Date("2026-03-22T18:00:00.000Z")
      )
    ).toBe("attachments-cycle-2b7a7f44-2026-03-22.zip");
  });

  it("renders a readable error manifest", () => {
    expect(buildAttachmentExportErrorsManifest(["resume.pdf: Blob not found"])).toContain(
      "resume.pdf: Blob not found"
    );
  });
});
