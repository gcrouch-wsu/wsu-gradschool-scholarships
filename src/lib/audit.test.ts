import { describe, it, expect, vi, beforeEach } from "vitest";
import { logAudit } from "./audit";

vi.mock("./db", () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
}));

describe("audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logAudit calls query with correct params", async () => {
    const { query } = await import("./db");
    await logAudit({
      actorUserId: "user-1",
      cycleId: "cycle-1",
      actionType: "test.action",
      targetType: "cycle",
      targetId: "cycle-1",
      metadata: { key: "value" },
    });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = (query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(sql).toContain("INSERT INTO audit_logs");
    expect(params).toEqual([
      "user-1",
      "cycle-1",
      "test.action",
      "cycle",
      "cycle-1",
      '{"key":"value"}',
    ]);
  });

  it("logAudit handles null actor and metadata", async () => {
    const { query } = await import("./db");
    await logAudit({
      actionType: "system.event",
    });
    expect(query).toHaveBeenCalledTimes(1);
    const [, params] = (query as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(params[0]).toBeNull();
    expect(params[1]).toBeNull();
    expect(params[5]).toBeNull();
  });
});
