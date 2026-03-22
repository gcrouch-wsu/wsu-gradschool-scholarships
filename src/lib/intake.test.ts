import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildBlobPathname,
  checkRateLimit,
  createSignedIntakeFileUrl,
  hashIp,
  processSubmission,
  sanitizeBlobFilename,
  verifySignedIntakeFileUrl,
} from "./intake";

const {
  queryMock,
  withTransactionMock,
  decryptMock,
  addRowMock,
  getSheetSchemaMock,
  logAuditMock,
  headMock,
} = vi.hoisted(() => ({
  queryMock: vi.fn(),
  withTransactionMock: vi.fn(),
  decryptMock: vi.fn(),
  addRowMock: vi.fn(),
  getSheetSchemaMock: vi.fn(),
  logAuditMock: vi.fn(),
  headMock: vi.fn(),
}));

vi.mock("./db", () => ({
  query: queryMock,
  withTransaction: withTransactionMock,
}));

vi.mock("./encryption", () => ({
  decrypt: decryptMock,
}));

vi.mock("./smartsheet", () => ({
  addRow: addRowMock,
  getSheetSchema: getSheetSchemaMock,
}));

vi.mock("./audit", () => ({
  logAudit: logAuditMock,
}));

vi.mock("@vercel/blob", () => ({
  head: headMock,
}));

describe("intake helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ENCRYPTION_KEY = "test-key-32-chars-long-exactly-32";

    queryMock.mockImplementation((sql: string) => {
      if (sql.includes("count(*)")) {
        return Promise.resolve({ rows: [{ count: "0" }], rowCount: 1 });
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    withTransactionMock.mockImplementation(async (callback) => callback(queryMock));
    decryptMock.mockReturnValue("smartsheet-token");
    addRowMock.mockResolvedValue({ ok: true, rowId: 999 });
    getSheetSchemaMock.mockResolvedValue({
      ok: true,
      sheet: { id: 55, name: "Test Sheet", columns: [] },
    });
    logAuditMock.mockResolvedValue(undefined);
    headMock.mockResolvedValue({
      pathname: "intake/cycle-1/submission-1/resume/upload.pdf",
      url: "https://blob.example/resume.pdf",
      contentType: "application/pdf",
      size: 123,
    });
  });

  describe("hashIp", () => {
    it("hashes IP consistently", () => {
      const ip = "1.2.3.4";
      const h1 = hashIp(ip);
      const h2 = hashIp(ip);
      expect(h1).toBe(h2);
      expect(h1).not.toBe(ip);
    });

    it("hashes different IPs differently", () => {
      expect(hashIp("1.2.3.4")).not.toBe(hashIp("1.2.3.5"));
    });
  });

  describe("checkRateLimit", () => {
    it("records the event and returns ok if under limit", async () => {
      const { query } = await import("./db");
      const result = await checkRateLimit("cycle-1", "1.2.3.4", "submit");
      expect(result.ok).toBe(true);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO intake_rate_limit_events"),
        expect.any(Array)
      );
    });

    it("returns error if over limit for upload-token", async () => {
      const { query } = await import("./db");
      (query as any).mockImplementation((sql: string) => {
        if (sql.includes("SELECT count(*)")) {
          return Promise.resolve({ rows: [{ count: "11" }] });
        }
        return Promise.resolve({ rows: [] });
      });
      
      const result = await checkRateLimit("cycle-1", "1.2.3.4", "upload-token");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("Rate limit exceeded");
    });
  });

  describe("blob helpers", () => {
    it("sanitizes filenames into safe blob path segments", () => {
      expect(sanitizeBlobFilename(" Final CV (v2).PDF ")).toBe("Final-CV-v2.pdf");
      expect(buildBlobPathname("cycle-1", "submission-1", "resume", " Final CV (v2).PDF ")).toBe(
        "intake/cycle-1/submission-1/resume/Final-CV-v2.pdf"
      );
    });
  });

  describe("signed intake file URLs", () => {
    it("creates verifiable signed file links", () => {
      const url = new URL(`https://example.test${createSignedIntakeFileUrl("file-123", 9_999_999_999_999)}`);
      const expires = Number(url.searchParams.get("expires"));
      const signature = url.searchParams.get("signature") || "";

      expect(verifySignedIntakeFileUrl("file-123", expires, signature)).toBe(true);
      expect(verifySignedIntakeFileUrl("file-456", expires, signature)).toBe(false);
    });
  });

  describe("processSubmission", () => {
    it("reuses an existing completed submission after a unique insert race", async () => {
      withTransactionMock.mockRejectedValueOnce({ code: "23505" });
      queryMock.mockImplementation((sql: string) => {
        if (sql.includes("FROM intake_submissions WHERE submission_id = $1")) {
          return Promise.resolve({
            rows: [
              {
                id: "submission-row-1",
                status: "completed",
                smartsheet_row_id: 42,
                request_cells_json: {},
                request_files_json: [],
              },
            ],
            rowCount: 1,
          });
        }
        if (sql.includes("count(*)")) {
          return Promise.resolve({ rows: [{ count: "0" }], rowCount: 1 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });

      const result = await processSubmission({
        cycleId: "cycle-1",
        submissionId: "submission-1",
        formVersionId: "version-1",
        submitterEmail: "staff@wsu.edu",
        fields: {},
        files: [],
        ip: "1.2.3.4",
      });

      expect(result).toEqual({ success: true, rowId: 42, status: 200 });
      expect(addRowMock).not.toHaveBeenCalled();
    });

    it("resumes a row_created submission without creating a second Smartsheet row", async () => {
      const snapshot = { title: "Intake Form", fields: [] };

      withTransactionMock.mockImplementationOnce(async (callback) =>
        callback(async (sql: string) => {
          if (sql.includes("FROM intake_submissions WHERE submission_id = $1")) {
            return {
              rows: [
                {
                  id: "submission-row-2",
                  status: "row_created",
                  smartsheet_row_id: 777,
                  request_cells_json: {},
                  request_files_json: [],
                },
              ],
              rowCount: 1,
            };
          }
          if (sql.includes("UPDATE intake_submissions SET status = 'processing'")) {
            return { rows: [], rowCount: 1 };
          }
          return { rows: [], rowCount: 0 };
        })
      );

      queryMock.mockImplementation((sql: string) => {
        if (sql.includes("SELECT snapshot_json FROM intake_form_versions")) {
          return Promise.resolve({ rows: [{ snapshot_json: snapshot }], rowCount: 1 });
        }
        if (sql.includes("SELECT connection_id, sheet_id FROM scholarship_cycles")) {
          return Promise.resolve({ rows: [{ connection_id: "conn-1", sheet_id: 55 }], rowCount: 1 });
        }
        if (sql.includes("SELECT encrypted_credentials FROM connections")) {
          return Promise.resolve({ rows: [{ encrypted_credentials: "ciphertext" }], rowCount: 1 });
        }
        if (sql.includes("SELECT field_key FROM intake_submission_files")) {
          return Promise.resolve({ rows: [], rowCount: 0 });
        }
        if (sql.includes("UPDATE intake_submissions SET request_cells_json = $1")) {
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
        if (sql.includes("UPDATE intake_submissions SET status = 'completed'")) {
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
        if (sql.includes("count(*)")) {
          return Promise.resolve({ rows: [{ count: "0" }], rowCount: 1 });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });

      const result = await processSubmission({
        cycleId: "cycle-1",
        submissionId: "submission-1",
        formVersionId: "version-1",
        submitterEmail: "staff@wsu.edu",
        fields: {},
        files: [],
        ip: "1.2.3.4",
      });

      expect(result).toEqual({ success: true, rowId: 777, status: 201 });
      expect(addRowMock).not.toHaveBeenCalled();
    });
  });
});
