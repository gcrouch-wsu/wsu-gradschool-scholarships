import { describe, expect, it } from "vitest";
import { normalizeDraftLayout } from "./layout-editor";
import { bindFieldsToLayout } from "./layout-runtime";
import type { DraftLayoutJson } from "./layout-editor";

describe("layout runtime helpers", () => {
  it("normalizes partial draft rows into valid saved rows", () => {
    const draft: DraftLayoutJson = {
      version: 1,
      sections: [
        {
          section_key: "main",
          label: "Main",
          sort_order: 0,
          rows: [
            {
              row_key: "row_1",
              mode: "two_up",
              items: [
                { item_key: "item_1", field_key: "student_name", width: "half" },
                { item_key: "item_2", field_key: null, width: "half" },
              ],
            },
            {
              row_key: "row_2",
              mode: "two_up",
              items: [
                { item_key: "item_3", field_key: "gpa", width: "half" },
                { item_key: "item_4", field_key: "credits", width: "half" },
              ],
            },
            {
              row_key: "row_3",
              mode: "full",
              items: [{ item_key: "item_5", field_key: null, width: "full" }],
            },
          ],
        },
      ],
    };

    const normalized = normalizeDraftLayout(draft, [
      { section_key: "main", label: "Main", sort_order: 0 },
    ]);

    expect(normalized.sections[0]?.rows).toHaveLength(2);
    expect(normalized.sections[0]?.rows[0]?.items).toEqual([
      { item_key: "item_1", field_key: "student_name", width: "full" },
    ]);
    expect(normalized.sections[0]?.rows[1]?.items).toEqual([
      { item_key: "item_3", field_key: "gpa", width: "half" },
      { item_key: "item_4", field_key: "credits", width: "half" },
    ]);
  });

  it("binds pinned and unplaced fields predictably", () => {
    const layout = {
      version: 1 as const,
      pinned_field_keys: ["student_name"],
      sections: [
        {
          section_key: "review",
          label: "Review",
          sort_order: 0,
          rows: [
            {
              row_key: "row_1",
              items: [
                { item_key: "item_1", field_key: "gpa", width: "half" as const },
                { item_key: "item_2", field_key: "credits", width: "half" as const },
              ],
            },
          ],
        },
      ],
    };

    const bound = bindFieldsToLayout({
      layoutJson: layout,
      fields: [
        { fieldKey: "student_name", label: "Student Name" },
        { fieldKey: "gpa", label: "GPA" },
        { fieldKey: "credits", label: "Credits" },
        { fieldKey: "major", label: "Major" },
      ],
      getFieldKey: (field) => field.fieldKey,
      sections: [{ section_key: "review", label: "Review", sort_order: 0 }],
      pinnedFieldKeys: ["student_name"],
    });

    expect(bound.pinnedFields.map((field) => field.fieldKey)).toEqual(["student_name"]);
    expect(bound.sections[0]?.rows).toHaveLength(2);
    expect(bound.sections[0]?.rows[0]?.fields.map((field) => field.fieldKey)).toEqual([
      "gpa",
      "credits",
    ]);
    expect(bound.sections[0]?.rows[0]?.items.map((item) => item.width)).toEqual([
      "half",
      "half",
    ]);
    expect(bound.sections[0]?.rows[1]?.fields.map((field) => field.fieldKey)).toEqual([
      "major",
    ]);
    expect(bound.sections[0]?.rows[1]?.items.map((item) => item.width)).toEqual(["full"]);
  });

  it("preserves three-column rows at runtime", () => {
    const layout = {
      version: 1 as const,
      sections: [
        {
          section_key: "main",
          label: "Main",
          sort_order: 0,
          rows: [
            {
              row_key: "row_1",
              items: [
                { item_key: "item_1", field_key: "email", width: "third" as const },
                { item_key: "item_2", field_key: "student_id", width: "third" as const },
                { item_key: "item_3", field_key: "term", width: "third" as const },
              ],
            },
          ],
        },
      ],
    };

    const bound = bindFieldsToLayout({
      layoutJson: layout,
      fields: [
        { fieldKey: "email", label: "Email" },
        { fieldKey: "student_id", label: "Student ID" },
        { fieldKey: "term", label: "Term" },
      ],
      getFieldKey: (field) => field.fieldKey,
      sections: [{ section_key: "main", label: "Main", sort_order: 0 }],
    });

    expect(bound.sections[0]?.rows).toHaveLength(1);
    expect(bound.sections[0]?.rows[0]?.fields.map((field) => field.fieldKey)).toEqual([
      "email",
      "student_id",
      "term",
    ]);
    expect(bound.sections[0]?.rows[0]?.items.map((item) => item.width)).toEqual([
      "third",
      "third",
      "third",
    ]);
  });
});
