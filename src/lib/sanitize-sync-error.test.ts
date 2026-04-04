import { describe, expect, it } from "vitest";
import { sanitizeSyncErrorForStorage } from "./sanitize-sync-error";

describe("sanitizeSyncErrorForStorage", () => {
  it("redacts Bearer tokens", () => {
    expect(sanitizeSyncErrorForStorage('Failed: Bearer eyJhbGciOiJIUzI1NiJ9.x')).toContain("[redacted]");
    expect(sanitizeSyncErrorForStorage('Failed: Bearer eyJhbGciOiJIUzI1NiJ9.x')).not.toContain("eyJ");
  });

  it("truncates very long messages", () => {
    const long = "x".repeat(5000);
    expect(sanitizeSyncErrorForStorage(long).length).toBeLessThanOrEqual(4002);
  });
});
