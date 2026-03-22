import type { SavedLayoutJson } from "./layout";

interface SectionLike {
  section_key: string;
  label: string;
  sort_order: number;
}

interface BoundLayoutRow<T> {
  row_key: string;
  fields: T[];
}

interface BoundLayoutSection<T> extends SectionLike {
  rows: BoundLayoutRow<T>[];
}

export function bindFieldsToLayout<T>(args: {
  layoutJson: SavedLayoutJson | null | undefined;
  fields: T[];
  getFieldKey: (field: T) => string;
  sections: SectionLike[];
  pinnedFieldKeys?: string[];
}): {
  pinnedFields: T[];
  sections: BoundLayoutSection<T>[];
} {
  const pinnedSet = new Set(args.pinnedFieldKeys ?? []);
  const fieldMap = new Map(args.fields.map((field) => [args.getFieldKey(field), field]));
  const pinnedFields = (args.pinnedFieldKeys ?? [])
    .map((fieldKey) => fieldMap.get(fieldKey))
    .filter((field): field is T => Boolean(field));
  const unpinnedFieldMap = new Map(
    args.fields
      .filter((field) => !pinnedSet.has(args.getFieldKey(field)))
      .map((field) => [args.getFieldKey(field), field])
  );
  const layoutSections =
    args.sections.length > 0 ? args.sections : [{ section_key: "main", label: "Main", sort_order: 0 }];

  const boundSections: BoundLayoutSection<T>[] = layoutSections.map((section) => ({
    section_key: section.section_key,
    label: section.label,
    sort_order: section.sort_order,
    rows: [],
  }));
  const sectionMap = new Map(boundSections.map((section) => [section.section_key, section]));
  const placedFieldKeys = new Set<string>();

  for (const section of args.layoutJson?.sections ?? []) {
    const targetSection = sectionMap.get(section.section_key);
    if (!targetSection) continue;

    for (const row of section.rows) {
      const rowFields: T[] = [];
      for (const item of row.items) {
        if (!item.field_key || placedFieldKeys.has(item.field_key)) continue;
        const field = unpinnedFieldMap.get(item.field_key);
        if (!field) continue;
        placedFieldKeys.add(item.field_key);
        rowFields.push(field);
      }

      if (rowFields.length > 0) {
        targetSection.rows.push({
          row_key: row.row_key,
          fields: rowFields,
        });
      }
    }
  }

  const fallbackSection = boundSections[0];
  if (fallbackSection) {
    for (const [fieldKey, field] of unpinnedFieldMap.entries()) {
      if (placedFieldKeys.has(fieldKey)) continue;
      fallbackSection.rows.push({
        row_key: `fallback_${fieldKey}`,
        fields: [field],
      });
    }
  }

  return {
    pinnedFields,
    sections: boundSections,
  };
}
