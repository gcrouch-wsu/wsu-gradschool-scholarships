export const LAYOUT_VERSION = 1 as const;

export type LayoutWidth = "full" | "half" | "third";

export interface SavedLayoutItem {
  item_key: string;
  field_key: string;
  width: LayoutWidth;
}

export interface SavedLayoutRow {
  row_key: string;
  items: SavedLayoutItem[];
}

export interface SavedLayoutSection {
  section_key: string;
  label: string;
  sort_order: number;
  rows: SavedLayoutRow[];
}

export interface SavedLayoutJson {
  version: typeof LAYOUT_VERSION;
  sections: SavedLayoutSection[];
  pinned_field_keys?: string[];
}

interface OrderedFieldLike {
  field_key: string;
  sort_order?: number | null;
}

interface ReviewerFieldLike {
  fieldKey: string;
  sectionKey?: string | null;
  sortOrder?: number | null;
  pinned?: boolean | null;
}

interface ReviewerSectionLike {
  section_key: string;
  label: string;
  sort_order?: number | null;
}

interface ValidateLayoutOptions {
  knownFieldKeys: string[];
  pinnedFieldKeys?: string[];
  requireAllPlaced?: boolean;
  allowedSectionKeys?: string[];
}

type ValidateLayoutResult =
  | { ok: true; normalized: SavedLayoutJson }
  | { ok: false; error: string };

function nextRowKey() {
  return `row_${crypto.randomUUID()}`;
}

function nextItemKey() {
  return `item_${crypto.randomUUID()}`;
}

function sortByOrder<T extends { sort_order?: number | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
}

export function createEmptyLayout(
  sectionKey = "main",
  label = "Main"
): SavedLayoutJson {
  return {
    version: LAYOUT_VERSION,
    sections: [
      {
        section_key: sectionKey,
        label,
        sort_order: 0,
        rows: [],
      },
    ],
  };
}

export function buildIntakeLayoutFromFields(
  fields: OrderedFieldLike[]
): SavedLayoutJson {
  const orderedFields = sortByOrder(fields);
  return {
    version: LAYOUT_VERSION,
    sections: [
      {
        section_key: "main",
        label: "Main",
        sort_order: 0,
        rows: orderedFields.map((field) => ({
          row_key: nextRowKey(),
          items: [
            {
              item_key: nextItemKey(),
              field_key: field.field_key,
              width: "full",
            },
          ],
        })),
      },
    ],
  };
}

export function buildReviewerLayoutFromFields(
  fields: ReviewerFieldLike[],
  sections: ReviewerSectionLike[],
  pinnedFieldKeys: string[] = []
): SavedLayoutJson {
  const pinned = new Set(pinnedFieldKeys);
  const normalizedSections =
    sections.length > 0
      ? sortByOrder(sections).map((section, index) => ({
          section_key: section.section_key,
          label: section.label,
          sort_order: index,
        }))
      : [{ section_key: "main", label: "Review", sort_order: 0 }];
  const defaultSectionKey = normalizedSections[0]!.section_key;
  const orderedFields = [...fields].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  );

  const rowsBySection = new Map<string, SavedLayoutRow[]>(
    normalizedSections.map((section) => [section.section_key, []])
  );

  for (const field of orderedFields) {
    if (field.pinned || pinned.has(field.fieldKey)) {
      continue;
    }
    const sectionKey =
      field.sectionKey && rowsBySection.has(field.sectionKey)
        ? field.sectionKey
        : defaultSectionKey;
    rowsBySection.get(sectionKey)!.push({
      row_key: nextRowKey(),
      items: [
        {
          item_key: nextItemKey(),
          field_key: field.fieldKey,
          width: "full",
        },
      ],
    });
  }

  return {
    version: LAYOUT_VERSION,
    pinned_field_keys: [...pinned],
    sections: normalizedSections.map((section, index) => ({
      section_key: section.section_key,
      label: section.label,
      sort_order: index,
      rows: rowsBySection.get(section.section_key) ?? [],
    })),
  };
}

export function validateLayoutJson(
  layout: unknown,
  options: ValidateLayoutOptions
): ValidateLayoutResult {
  if (!layout || typeof layout !== "object") {
    return { ok: false, error: "layout_json must be an object" };
  }

  const candidate = layout as Partial<SavedLayoutJson>;
  if (candidate.version !== LAYOUT_VERSION) {
    return { ok: false, error: `Unsupported layout version: ${String(candidate.version)}` };
  }
  if (!Array.isArray(candidate.sections)) {
    return { ok: false, error: "layout_json.sections must be an array" };
  }

  const knownFieldKeys = new Set(options.knownFieldKeys);
  const pinnedFieldKeys = new Set(options.pinnedFieldKeys ?? candidate.pinned_field_keys ?? []);
  const allowedSectionKeys = options.allowedSectionKeys
    ? new Set(options.allowedSectionKeys)
    : null;

  for (const fieldKey of pinnedFieldKeys) {
    if (!knownFieldKeys.has(fieldKey)) {
      return { ok: false, error: `Pinned field "${fieldKey}" does not exist` };
    }
  }

  const seenSectionKeys = new Set<string>();
  const seenRowKeys = new Set<string>();
  const seenItemKeys = new Set<string>();
  const seenFieldKeys = new Set<string>();

  const normalizedSections: SavedLayoutSection[] = [];

  for (const [sectionIndex, rawSection] of candidate.sections.entries()) {
    if (!rawSection || typeof rawSection !== "object") {
      return { ok: false, error: `Section ${sectionIndex + 1} is invalid` };
    }
    if (typeof rawSection.section_key !== "string" || rawSection.section_key.trim() === "") {
      return { ok: false, error: "Each section must have a section_key" };
    }
    if (seenSectionKeys.has(rawSection.section_key)) {
      return { ok: false, error: `Duplicate section_key: ${rawSection.section_key}` };
    }
    if (allowedSectionKeys && !allowedSectionKeys.has(rawSection.section_key)) {
      return {
        ok: false,
        error: `Section "${rawSection.section_key}" is not a valid target section`,
      };
    }
    seenSectionKeys.add(rawSection.section_key);

    if (!Array.isArray(rawSection.rows)) {
      return { ok: false, error: `Section "${rawSection.section_key}" must define rows` };
    }

    const normalizedRows: SavedLayoutRow[] = [];
    for (const [rowIndex, rawRow] of rawSection.rows.entries()) {
      if (!rawRow || typeof rawRow !== "object") {
        return {
          ok: false,
          error: `Row ${rowIndex + 1} in section "${rawSection.section_key}" is invalid`,
        };
      }
      if (typeof rawRow.row_key !== "string" || rawRow.row_key.trim() === "") {
        return { ok: false, error: `Row ${rowIndex + 1} is missing row_key` };
      }
      if (seenRowKeys.has(rawRow.row_key)) {
        return { ok: false, error: `Duplicate row_key: ${rawRow.row_key}` };
      }
      seenRowKeys.add(rawRow.row_key);

      if (!Array.isArray(rawRow.items) || rawRow.items.length === 0) {
        return { ok: false, error: `Row ${rawRow.row_key} has no items` };
      }

      const normalizedItems: SavedLayoutItem[] = [];
      for (const [itemIndex, rawItem] of rawRow.items.entries()) {
        if (!rawItem || typeof rawItem !== "object") {
          return {
            ok: false,
            error: `Item ${itemIndex + 1} in row "${rawRow.row_key}" is invalid`,
          };
        }
        if (typeof rawItem.item_key !== "string" || rawItem.item_key.trim() === "") {
          return { ok: false, error: `Row "${rawRow.row_key}" contains an item without item_key` };
        }
        if (seenItemKeys.has(rawItem.item_key)) {
          return { ok: false, error: `Duplicate item_key: ${rawItem.item_key}` };
        }
        seenItemKeys.add(rawItem.item_key);

        if (
          typeof rawItem.field_key !== "string" ||
          rawItem.field_key.trim() === "" ||
          !knownFieldKeys.has(rawItem.field_key)
        ) {
          return {
            ok: false,
            error: `Row "${rawRow.row_key}" references unknown field "${String(rawItem.field_key)}"`,
          };
        }
        if (seenFieldKeys.has(rawItem.field_key)) {
          return { ok: false, error: `Field "${rawItem.field_key}" appears more than once in the layout` };
        }
        if (pinnedFieldKeys.has(rawItem.field_key)) {
          return { ok: false, error: `Pinned field "${rawItem.field_key}" cannot appear inside section rows` };
        }
        if (
          rawItem.width !== "full" &&
          rawItem.width !== "half" &&
          rawItem.width !== "third"
        ) {
          return {
            ok: false,
            error: `Field "${rawItem.field_key}" in row "${rawRow.row_key}" has invalid width`,
          };
        }

        seenFieldKeys.add(rawItem.field_key);
        normalizedItems.push({
          item_key: rawItem.item_key,
          field_key: rawItem.field_key,
          width: rawItem.width,
        });
      }

      const widths = normalizedItems.map((item) => item.width);
      const validRow =
        (normalizedItems.length === 1 && widths[0] === "full") ||
        (normalizedItems.length === 2 && widths[0] === "half" && widths[1] === "half") ||
        (
          normalizedItems.length === 3 &&
          widths[0] === "third" &&
          widths[1] === "third" &&
          widths[2] === "third"
        );
      if (!validRow) {
        return {
          ok: false,
          error: `Row "${rawRow.row_key}" must be either one full item, two half items, or three third items`,
        };
      }

      normalizedRows.push({
        row_key: rawRow.row_key,
        items: normalizedItems,
      });
    }

    normalizedSections.push({
      section_key: rawSection.section_key,
      label:
        typeof rawSection.label === "string" && rawSection.label.trim() !== ""
          ? rawSection.label
          : rawSection.section_key,
      sort_order: sectionIndex,
      rows: normalizedRows,
    });
  }

  if (options.requireAllPlaced) {
    for (const fieldKey of knownFieldKeys) {
      if (!pinnedFieldKeys.has(fieldKey) && !seenFieldKeys.has(fieldKey)) {
        return { ok: false, error: `Field "${fieldKey}" is not placed in the layout` };
      }
    }
  }

  return {
    ok: true,
    normalized: {
      version: LAYOUT_VERSION,
      sections: normalizedSections,
      ...(pinnedFieldKeys.size > 0 ? { pinned_field_keys: [...pinnedFieldKeys] } : {}),
    },
  };
}

export function readLayoutJsonOrFallback(
  layout: unknown,
  fallback: SavedLayoutJson,
  options: ValidateLayoutOptions
): SavedLayoutJson {
  const candidate = validateLayoutJson(layout, options);
  if (candidate.ok) {
    return candidate.normalized;
  }
  const fallbackValidation = validateLayoutJson(fallback, options);
  if (fallbackValidation.ok) {
    return fallbackValidation.normalized;
  }
  return fallback;
}
