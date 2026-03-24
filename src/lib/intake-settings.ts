export const MAX_INTAKE_TEXT_CHARACTER_LIMIT = 10000;

export function isIntakeTextFieldType(fieldType: string): fieldType is "short_text" | "long_text" {
  return fieldType === "short_text" || fieldType === "long_text";
}

export function hasConfiguredIntakeTextMaxLength(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

export function parseIntakeTextMaxLength(value: unknown): number | null {
  if (!hasConfiguredIntakeTextMaxLength(value)) return null;

  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d+$/.test(value.trim())
        ? Number.parseInt(value.trim(), 10)
        : Number.NaN;

  if (!Number.isInteger(parsed)) return null;
  if (parsed < 1 || parsed > MAX_INTAKE_TEXT_CHARACTER_LIMIT) return null;
  return parsed;
}
