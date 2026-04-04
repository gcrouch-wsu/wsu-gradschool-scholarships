/**
 * Optional per-membership row visibility (scholarship_memberships.filter_criteria_json).
 *
 * Supported shape (v1):
 * ```json
 * {
 *   "rules": [
 *     { "columnId": 123456789, "op": "eq", "value": "Biology" },
 *     { "columnId": 987654321, "op": "in", "values": ["A", "B"] },
 *     { "columnId": 111, "op": "contains", "value": "honors" },
 *     { "columnId": 222, "op": "is_empty" },
 *     { "columnId": 333, "op": "is_not_empty" },
 *     { "columnId": 444, "op": "not_in", "values": ["X"] }
 *   ]
 * }
 * ```
 * All rules are ANDed. Unknown ops or malformed rules are ignored (no filtering for that rule).
 * Null / missing / empty `rules` => no filtering (all rows visible).
 */

export type MembershipRow = { cells: Record<number, unknown> };

type FilterOp = "eq" | "in" | "not_in" | "contains" | "is_empty" | "is_not_empty";

interface FilterRule {
  columnId: unknown;
  op: unknown;
  value?: unknown;
  values?: unknown;
}

function normCell(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function parseRules(criteria: unknown): FilterRule[] | null {
  if (criteria == null || typeof criteria !== "object") return null;
  const rules = (criteria as { rules?: unknown }).rules;
  if (!Array.isArray(rules) || rules.length === 0) return null;
  return rules.filter((r): r is FilterRule => r != null && typeof r === "object");
}

function ruleMatches(row: MembershipRow, rule: FilterRule): boolean {
  const colId = typeof rule.columnId === "number" ? rule.columnId : Number(rule.columnId);
  if (!Number.isFinite(colId)) return true;
  const op = rule.op;
  if (typeof op !== "string") return true;

  const cell = row.cells[colId];
  const cellStr = normCell(cell);

  switch (op as FilterOp) {
    case "is_empty":
      return cellStr === "";
    case "is_not_empty":
      return cellStr !== "";
    case "eq":
      return cellStr === normCell(rule.value);
    case "contains":
      if (rule.value == null) return true;
      const needle = normCell(rule.value).toLowerCase();
      if (!needle) return true;
      return cellStr.toLowerCase().includes(needle);
    case "in": {
      const vals = rule.values;
      if (!Array.isArray(vals) || vals.length === 0) return true;
      const set = new Set(vals.map((v) => normCell(v)));
      return set.has(cellStr);
    }
    case "not_in": {
      const vals = rule.values;
      if (!Array.isArray(vals) || vals.length === 0) return true;
      const set = new Set(vals.map((v) => normCell(v)));
      return !set.has(cellStr);
    }
    default:
      return true;
  }
}

/** When criteria is absent or has no usable rules, returns true for every row. */
export function rowMatchesMembershipFilter(row: MembershipRow, criteria: unknown): boolean {
  const rules = parseRules(criteria);
  if (!rules) return true;
  return rules.every((r) => ruleMatches(row, r));
}

export function filterRowsByMembershipCriteria<T extends MembershipRow>(
  rows: T[],
  criteria: unknown
): T[] {
  const rules = parseRules(criteria);
  if (!rules) return rows;
  return rows.filter((row) => rules.every((r) => ruleMatches(row, r)));
}
