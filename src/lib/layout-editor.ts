import type { SavedLayoutJson, SavedLayoutSection, SavedLayoutRow, SavedLayoutItem } from "./layout";
import { LAYOUT_VERSION } from "./layout";

export type DraftRowMode = "full" | "two_up" | "three_up";

export interface DraftLayoutItem {
  item_key: string;
  field_key: string | null;
  width: "full" | "half" | "third";
}

export interface DraftLayoutRow {
  row_key: string;
  mode: DraftRowMode;
  items: DraftLayoutItem[];
}

export interface DraftLayoutSection {
  section_key: string;
  label: string;
  sort_order: number;
  rows: DraftLayoutRow[];
}

export interface DraftLayoutJson {
  version: typeof LAYOUT_VERSION;
  sections: DraftLayoutSection[];
  pinned_field_keys?: string[];
}

interface SectionLike {
  section_key: string;
  label: string;
  sort_order?: number | null;
}

function nextKey(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function cloneDraftItem(item: DraftLayoutItem): DraftLayoutItem {
  return {
    item_key: item.item_key,
    field_key: item.field_key,
    width: item.width,
  };
}

function cloneDraftRow(row: DraftLayoutRow): DraftLayoutRow {
  return {
    row_key: row.row_key,
    mode: row.mode,
    items: row.items.map(cloneDraftItem),
  };
}

function cloneDraftSection(section: DraftLayoutSection): DraftLayoutSection {
  return {
    section_key: section.section_key,
    label: section.label,
    sort_order: section.sort_order,
    rows: section.rows.map(cloneDraftRow),
  };
}

export function cloneDraftLayout(layout: DraftLayoutJson): DraftLayoutJson {
  return {
    version: layout.version,
    sections: layout.sections.map(cloneDraftSection),
    ...(layout.pinned_field_keys ? { pinned_field_keys: [...layout.pinned_field_keys] } : {}),
  };
}

function createDraftItem(
  width: "full" | "half" | "third",
  fieldKey: string | null = null
): DraftLayoutItem {
  return {
    item_key: nextKey("item"),
    field_key: fieldKey,
    width,
  };
}

export function createDraftRow(mode: DraftRowMode = "full"): DraftLayoutRow {
  if (mode === "full") {
    return {
      row_key: nextKey("row"),
      mode,
      items: [createDraftItem("full")],
    };
  }
  if (mode === "two_up") {
    return {
      row_key: nextKey("row"),
      mode,
      items: [createDraftItem("half"), createDraftItem("half")],
    };
  }
  return {
    row_key: nextKey("row"),
    mode,
    items: [
      createDraftItem("third"),
      createDraftItem("third"),
      createDraftItem("third"),
    ],
  };
}

export function createDraftLayout(
  layout: SavedLayoutJson | null | undefined,
  sections: SectionLike[]
): DraftLayoutJson {
  const normalizedSections =
    sections.length > 0
      ? sections.map((section, index) => ({
          section_key: section.section_key,
          label: section.label,
          sort_order: section.sort_order ?? index,
        }))
      : [{ section_key: "main", label: "Main", sort_order: 0 }];

  const rowsBySection = new Map<string, DraftLayoutRow[]>();
  for (const section of normalizedSections) {
    rowsBySection.set(section.section_key, []);
  }

  if (layout?.sections?.length) {
    for (const rawSection of layout.sections) {
      if (!rowsBySection.has(rawSection.section_key)) continue;
      rowsBySection.set(
        rawSection.section_key,
        rawSection.rows.map((row) => ({
          row_key: row.row_key,
          mode:
            row.items.length === 3
              ? "three_up"
              : row.items.length === 2
                ? "two_up"
                : "full",
          items: row.items.map((item) => ({
            item_key: item.item_key,
            field_key: item.field_key,
            width: item.width,
          })),
        }))
      );
    }
  }

  return {
    version: LAYOUT_VERSION,
    sections: normalizedSections.map((section) => ({
      section_key: section.section_key,
      label: section.label,
      sort_order: section.sort_order,
      rows: rowsBySection.get(section.section_key) ?? [],
    })),
    ...(layout?.pinned_field_keys ? { pinned_field_keys: [...layout.pinned_field_keys] } : {}),
  };
}

export function getPlacedFieldKeys(layout: DraftLayoutJson): Set<string> {
  const placed = new Set<string>();
  for (const section of layout.sections) {
    for (const row of section.rows) {
      for (const item of row.items) {
        if (item.field_key) {
          placed.add(item.field_key);
        }
      }
    }
  }
  return placed;
}

export function getFieldSectionKey(
  layout: DraftLayoutJson,
  fieldKey: string
): string | null {
  for (const section of layout.sections) {
    for (const row of section.rows) {
      if (row.items.some((item) => item.field_key === fieldKey)) {
        return section.section_key;
      }
    }
  }
  return null;
}

export function syncDraftLayoutSections(
  layout: DraftLayoutJson,
  sections: SectionLike[]
): DraftLayoutJson {
  const nextSections =
    sections.length > 0
      ? sections.map((section, index) => ({
          section_key: section.section_key,
          label: section.label,
          sort_order: section.sort_order ?? index,
        }))
      : [{ section_key: "main", label: "Main", sort_order: 0 }];
  const existing = new Map(layout.sections.map((section) => [section.section_key, section]));
  const fallbackKey = nextSections[0]!.section_key;

  const result = createDraftLayout(
    {
      version: LAYOUT_VERSION,
      sections: nextSections.map((section) => ({
        section_key: section.section_key,
        label: section.label,
        sort_order: section.sort_order,
        rows: existing.get(section.section_key)?.rows.map((row) => ({
          row_key: row.row_key,
          items: row.items.map((item) => ({
            item_key: item.item_key,
            field_key: item.field_key ?? "",
            width: item.width,
          })) as SavedLayoutItem[],
        })) ?? [],
      })),
      ...(layout.pinned_field_keys ? { pinned_field_keys: [...layout.pinned_field_keys] } : {}),
    },
    nextSections
  );

  const removedSections = layout.sections.filter(
    (section) => !nextSections.some((candidate) => candidate.section_key === section.section_key)
  );
  if (removedSections.length === 0) {
    return result;
  }

  const fallbackSection = result.sections.find((section) => section.section_key === fallbackKey);
  if (!fallbackSection) {
    return result;
  }

  for (const removedSection of removedSections) {
    for (const row of removedSection.rows) {
      fallbackSection.rows.push(cloneDraftRow(row));
    }
  }

  return result;
}

function stripField(layout: DraftLayoutJson, fieldKey: string) {
  for (const section of layout.sections) {
    for (const row of section.rows) {
      for (const item of row.items) {
        if (item.field_key === fieldKey) {
          item.field_key = null;
        }
      }
    }
  }
}

export function removeFieldFromDraftLayout(
  layout: DraftLayoutJson,
  fieldKey: string
): DraftLayoutJson {
  const next = cloneDraftLayout(layout);
  stripField(next, fieldKey);
  return next;
}

export function renameFieldInDraftLayout(
  layout: DraftLayoutJson,
  previousFieldKey: string,
  nextFieldKey: string
): DraftLayoutJson {
  const next = cloneDraftLayout(layout);
  for (const section of next.sections) {
    for (const row of section.rows) {
      for (const item of row.items) {
        if (item.field_key === previousFieldKey) {
          item.field_key = nextFieldKey;
        }
      }
    }
  }
  return next;
}

export function appendFieldAsFullRow(
  layout: DraftLayoutJson,
  fieldKey: string,
  sectionKey?: string
): DraftLayoutJson {
  const next = cloneDraftLayout(layout);
  stripField(next, fieldKey);
  const targetSection =
    next.sections.find((section) => section.section_key === sectionKey) ?? next.sections[0];
  if (!targetSection) {
    return next;
  }
  targetSection.rows.push({
    row_key: nextKey("row"),
    mode: "full",
    items: [createDraftItem("full", fieldKey)],
  });
  return next;
}

export function addDraftRowToSection(
  layout: DraftLayoutJson,
  sectionKey: string,
  mode: DraftRowMode
): DraftLayoutJson {
  const next = cloneDraftLayout(layout);
  const section = next.sections.find((candidate) => candidate.section_key === sectionKey);
  if (!section) return next;
  section.rows.push(createDraftRow(mode));
  return next;
}

export function deleteDraftRow(
  layout: DraftLayoutJson,
  sectionKey: string,
  rowKey: string
): DraftLayoutJson {
  const next = cloneDraftLayout(layout);
  const section = next.sections.find((candidate) => candidate.section_key === sectionKey);
  if (!section) return next;
  section.rows = section.rows.filter((row) => row.row_key !== rowKey);
  return next;
}

export function moveDraftRow(
  layout: DraftLayoutJson,
  sectionKey: string,
  rowKey: string,
  direction: -1 | 1
): DraftLayoutJson {
  const next = cloneDraftLayout(layout);
  const section = next.sections.find((candidate) => candidate.section_key === sectionKey);
  if (!section) return next;
  const index = section.rows.findIndex((row) => row.row_key === rowKey);
  if (index < 0) return next;
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= section.rows.length) return next;
  const [row] = section.rows.splice(index, 1);
  section.rows.splice(targetIndex, 0, row);
  return next;
}

export function setDraftRowMode(
  layout: DraftLayoutJson,
  sectionKey: string,
  rowKey: string,
  mode: DraftRowMode
): DraftLayoutJson {
  const next = cloneDraftLayout(layout);
  const section = next.sections.find((candidate) => candidate.section_key === sectionKey);
  if (!section) return next;
  const row = section.rows.find((candidate) => candidate.row_key === rowKey);
  if (!row || row.mode === mode) return next;

  const existingFieldKeys = row.items.map((item) => item.field_key).filter((value): value is string => Boolean(value));
  row.mode = mode;
  row.items =
    mode === "full"
      ? [createDraftItem("full", existingFieldKeys[0] ?? null)]
      : mode === "two_up"
        ? [
            createDraftItem("half", existingFieldKeys[0] ?? null),
            createDraftItem("half", existingFieldKeys[1] ?? null),
          ]
        : [
            createDraftItem("third", existingFieldKeys[0] ?? null),
            createDraftItem("third", existingFieldKeys[1] ?? null),
            createDraftItem("third", existingFieldKeys[2] ?? null),
          ];
  return next;
}

export function assignFieldToDraftSlot(args: {
  layout: DraftLayoutJson;
  sectionKey: string;
  rowKey: string;
  slotIndex: number;
  fieldKey: string | null;
}): DraftLayoutJson {
  const next = cloneDraftLayout(args.layout);
  if (args.fieldKey) {
    stripField(next, args.fieldKey);
  }
  const section = next.sections.find((candidate) => candidate.section_key === args.sectionKey);
  if (!section) return next;
  const row = section.rows.find((candidate) => candidate.row_key === args.rowKey);
  if (!row) return next;
  if (!row.items[args.slotIndex]) return next;
  row.items[args.slotIndex] = {
    ...row.items[args.slotIndex],
    field_key: args.fieldKey,
  };
  return next;
}

export function normalizeDraftLayout(
  layout: DraftLayoutJson,
  sections?: SectionLike[]
): SavedLayoutJson {
  const synchronized = sections ? syncDraftLayoutSections(layout, sections) : cloneDraftLayout(layout);
  const normalizedSections: SavedLayoutSection[] = synchronized.sections.map((section, sectionIndex) => {
    const normalizedRows: SavedLayoutRow[] = [];

    for (const row of section.rows) {
      const filledItems = row.items.filter(
        (item): item is DraftLayoutItem & { field_key: string } => Boolean(item.field_key)
      );
      if (filledItems.length === 0) {
        continue;
      }

      if (filledItems.length === 1) {
        normalizedRows.push({
          row_key: row.row_key,
          items: [
            {
              item_key: filledItems[0].item_key,
              field_key: filledItems[0].field_key,
              width: "full",
            },
          ],
        });
        continue;
      }

      if (filledItems.length === 2) {
        normalizedRows.push({
          row_key: row.row_key,
          items: filledItems.slice(0, 2).map((item) => ({
            item_key: item.item_key,
            field_key: item.field_key,
            width: "half",
          })),
        });
        continue;
      }

      normalizedRows.push({
        row_key: row.row_key,
        items: filledItems.slice(0, 3).map((item) => ({
          item_key: item.item_key,
          field_key: item.field_key,
          width: "third",
        })),
      });
    }

    return {
      section_key: section.section_key,
      label: section.label,
      sort_order: section.sort_order ?? sectionIndex,
      rows: normalizedRows,
    };
  });

  return {
    version: LAYOUT_VERSION,
    sections: normalizedSections,
    ...(layout.pinned_field_keys ? { pinned_field_keys: [...layout.pinned_field_keys] } : {}),
  };
}
