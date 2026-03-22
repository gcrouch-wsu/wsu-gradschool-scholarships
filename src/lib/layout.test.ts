import { describe, expect, it } from "vitest";
import {
  buildIntakeLayoutFromFields,
  buildReviewerLayoutFromFields,
  readLayoutJsonOrFallback,
  validateLayoutJson,
} from "./layout";

describe("layout helpers", () => {
  it("builds a conservative intake layout with one full-width row per field", () => {
    const layout = buildIntakeLayoutFromFields([
      { field_key: "student_name", sort_order: 1 },
      { field_key: "student_id", sort_order: 0 },
    ]);

    expect(layout.sections).toHaveLength(1);
    expect(layout.sections[0]?.section_key).toBe("main");
    expect(layout.sections[0]?.rows.map((row) => row.items[0]?.field_key)).toEqual([
      "student_id",
      "student_name",
    ]);
    expect(layout.sections[0]?.rows.every((row) => row.items[0]?.width === "full")).toBe(true);
  });

  it("builds a reviewer layout that preserves sections and excludes pinned fields from rows", () => {
    const layout = buildReviewerLayoutFromFields(
      [
        { fieldKey: "identity", sectionKey: "overview", sortOrder: 0, pinned: true },
        { fieldKey: "score", sectionKey: "review", sortOrder: 2 },
        { fieldKey: "gpa", sectionKey: "overview", sortOrder: 1 },
      ],
      [
        { section_key: "overview", label: "Overview", sort_order: 0 },
        { section_key: "review", label: "Review", sort_order: 1 },
      ],
      ["identity"]
    );

    expect(layout.pinned_field_keys).toEqual(["identity"]);
    expect(layout.sections[0]?.rows.map((row) => row.items[0]?.field_key)).toEqual(["gpa"]);
    expect(layout.sections[1]?.rows.map((row) => row.items[0]?.field_key)).toEqual(["score"]);
  });

  it("rejects unsupported layout versions", () => {
    const result = validateLayoutJson(
      { version: 2, sections: [] },
      { knownFieldKeys: ["student_name"] }
    );

    expect(result).toEqual({
      ok: false,
      error: "Unsupported layout version: 2",
    });
  });

  it("falls back to normalized legacy layout when persisted layout is missing or unsupported", () => {
    const fallback = buildIntakeLayoutFromFields([{ field_key: "student_name", sort_order: 0 }]);

    const layout = readLayoutJsonOrFallback(
      { version: 2, sections: [] },
      fallback,
      {
        knownFieldKeys: ["student_name"],
        requireAllPlaced: true,
        allowedSectionKeys: ["main"],
      }
    );

    expect(layout).toEqual(fallback);
  });

  it("rejects pinned reviewer fields inside section rows", () => {
    const result = validateLayoutJson(
      {
        version: 1,
        pinned_field_keys: ["identity"],
        sections: [
          {
            section_key: "main",
            label: "Main",
            sort_order: 9,
            rows: [
              {
                row_key: "row_1",
                items: [
                  {
                    item_key: "item_1",
                    field_key: "identity",
                    width: "full",
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        knownFieldKeys: ["identity", "score"],
        pinnedFieldKeys: ["identity"],
        requireAllPlaced: false,
      }
    );

    expect(result).toEqual({
      ok: false,
      error: 'Pinned field "identity" cannot appear inside section rows',
    });
  });

  it("normalizes section sort_order to array order and requires all non-pinned fields on publish", () => {
    const result = validateLayoutJson(
      {
        version: 1,
        pinned_field_keys: ["identity"],
        sections: [
          {
            section_key: "review",
            label: "Review",
            sort_order: 8,
            rows: [
              {
                row_key: "row_1",
                items: [
                  {
                    item_key: "item_1",
                    field_key: "score",
                    width: "full",
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        knownFieldKeys: ["identity", "score"],
        pinnedFieldKeys: ["identity"],
        requireAllPlaced: true,
        allowedSectionKeys: ["review"],
      }
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.normalized.sections[0]?.sort_order).toBe(0);
    }
  });

  it("rejects invalid two-column row shapes", () => {
    const result = validateLayoutJson(
      {
        version: 1,
        sections: [
          {
            section_key: "main",
            label: "Main",
            sort_order: 0,
            rows: [
              {
                row_key: "row_1",
                items: [
                  {
                    item_key: "item_1",
                    field_key: "student_name",
                    width: "half",
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        knownFieldKeys: ["student_name"],
      }
    );

    expect(result).toEqual({
      ok: false,
      error: 'Row "row_1" must be either one full item or two half items',
    });
  });
});
