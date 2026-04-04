import { describe, it, expect, vi, beforeEach } from "vitest";
import { addRow } from "./smartsheet";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock as typeof fetch);

describe("smartsheet addRow", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("sends correct payload and handles success", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ result: [{ id: 456 }] })),
    } as Response);

    const result = await addRow("token", 123, [
      { columnId: 1, value: "test" },
      { columnId: 2, value: null },
      { columnId: 3, value: "Approved", strict: true },
    ]);

    expect(result.ok).toBe(true);
    expect(result.rowId).toBe(456);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/sheets/123/rows"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify([{ cells: [
          { columnId: 1, value: "test" },
          { columnId: 2, value: "" }, // null coerced to ""
          { columnId: 3, value: "Approved", strict: true }
        ] }]),
      })
    );
  });

  it("handles Smartsheet errors", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve(JSON.stringify({ errorCode: 1006, message: "Column not found" })),
    } as Response);

    const result = await addRow("token", 123, [{ columnId: 1, value: "test" }]);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe(1006);
    expect(result.error).toBe("Column not found");
  });
});
