import { describe, expect, it } from "vitest";
import { filterRowsByMembershipCriteria, rowMatchesMembershipFilter } from "./membership-row-filter";

describe("membership-row-filter", () => {
  const row = (cells: Record<number, unknown>) => ({ id: 1, cells });

  it("allows all rows when criteria is null", () => {
    const rows = [row({ 10: "A" })];
    expect(filterRowsByMembershipCriteria(rows, null)).toHaveLength(1);
    expect(rowMatchesMembershipFilter(rows[0]!, undefined)).toBe(true);
  });

  it("filters by eq", () => {
    const rows = [row({ 5: "X" }), row({ 5: "Y" })];
    const out = filterRowsByMembershipCriteria(rows, {
      rules: [{ columnId: 5, op: "eq", value: "Y" }],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.cells[5]).toBe("Y");
  });

  it("filters by in", () => {
    const rows = [row({ 1: "a" }), row({ 1: "b" }), row({ 1: "c" })];
    const out = filterRowsByMembershipCriteria(rows, {
      rules: [{ columnId: 1, op: "in", values: ["a", "c"] }],
    });
    expect(out.map((r) => r.cells[1])).toEqual(["a", "c"]);
  });

  it("handles is_empty", () => {
    const rows = [row({ 2: "" }), row({ 2: "z" }), row({ 2: null })];
    const out = filterRowsByMembershipCriteria(rows, {
      rules: [{ columnId: 2, op: "is_empty" }],
    });
    expect(out).toHaveLength(2);
  });
});
