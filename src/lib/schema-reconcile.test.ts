import { describe, expect, it } from "vitest";
import {
  planFieldConfigReconciliation,
  planIntakeFieldReconciliation,
} from "./schema-reconcile";

describe("schema reconciliation", () => {
  it("remaps reviewer field configs by unique matching title when column ids change", () => {
    const updates = planFieldConfigReconciliation(
      [
        {
          id: "fc-1",
          source_column_id: 111,
          source_column_title: "Overall Score",
          display_label: "Overall Score",
        },
      ],
      [
        { id: 222, title: "Overall Score", type: "PICKLIST" },
        { id: 333, title: "Comments", type: "TEXT_NUMBER" },
      ]
    );

    expect(updates).toEqual([
      {
        id: "fc-1",
        source_column_id: 222,
        source_column_title: "Overall Score",
        display_label: "Overall Score",
      },
    ]);
  });

  it("does not remap when the title match is ambiguous", () => {
    const updates = planFieldConfigReconciliation(
      [
        {
          id: "fc-1",
          source_column_id: 111,
          source_column_title: "Score",
          display_label: "Review score",
        },
      ],
      [
        { id: 222, title: "Score", type: "PICKLIST" },
        { id: 333, title: "score", type: "TEXT_NUMBER" },
      ]
    );

    expect(updates).toEqual([]);
  });

  it("refreshes reviewer display labels only when they still match the source title", () => {
    const updates = planFieldConfigReconciliation(
      [
        {
          id: "fc-1",
          source_column_id: "444",
          source_column_title: "Student Name",
          display_label: "Student Name",
        },
        {
          id: "fc-2",
          source_column_id: "555",
          source_column_title: "Student Name",
          display_label: "Nominee",
        },
      ],
      [
        { id: 444, title: "Nominee Name", type: "TEXT_NUMBER" },
        { id: 555, title: "Nominee Name", type: "TEXT_NUMBER" },
      ]
    );

    expect(updates).toEqual([
      {
        id: "fc-1",
        source_column_id: 444,
        source_column_title: "Nominee Name",
        display_label: "Nominee Name",
      },
      {
        id: "fc-2",
        source_column_id: 555,
        source_column_title: "Nominee Name",
        display_label: "Nominee",
      },
    ]);
  });

  it("refreshes intake mappings to the current title, type, and label when the label still matched the old title", () => {
    const updates = planIntakeFieldReconciliation(
      [
        {
          id: "iff-1",
          target_column_id: "444",
          target_column_title: "Student Name",
          target_column_type: "TEXT_NUMBER",
          label: "Student Name",
          field_type: "short_text",
          settings_json: {},
        },
      ],
      [{ id: 444, title: "Nominee Name", type: "TEXT_NUMBER" }]
    );

    expect(updates).toEqual([
      {
        id: "iff-1",
        target_column_id: 444,
        target_column_title: "Nominee Name",
        target_column_type: "TEXT_NUMBER",
        label: "Nominee Name",
        field_type: "short_text",
        settings_json: {},
      },
    ]);
  });

  it("refreshes mapped picklist options on intake fields during schema sync", () => {
    const updates = planIntakeFieldReconciliation(
      [
        {
          id: "iff-1",
          target_column_id: "444",
          target_column_title: "Department",
          target_column_type: "PICKLIST",
          label: "Department",
          field_type: "select",
          settings_json: { options: ["Old A", "Old B"] },
        },
      ],
      [{ id: 444, title: "Department", type: "PICKLIST", options: ["Arts", "Sciences"] }]
    );

    expect(updates).toEqual([
      {
        id: "iff-1",
        target_column_id: 444,
        target_column_title: "Department",
        target_column_type: "PICKLIST",
        label: "Department",
        field_type: "select",
        settings_json: { options: ["Arts", "Sciences"] },
      },
    ]);
  });

  it("preserves custom intake labels while still updating type-driven metadata", () => {
    const updates = planIntakeFieldReconciliation(
      [
        {
          id: "iff-1",
          target_column_id: "444",
          target_column_title: "Department",
          target_column_type: "PICKLIST",
          label: "Academic unit",
          field_type: "select",
          settings_json: { options: ["Old A", "Old B"] },
        },
      ],
      [{ id: 444, title: "Program Department", type: "PICKLIST", options: ["Arts", "Sciences"] }]
    );

    expect(updates).toEqual([
      {
        id: "iff-1",
        target_column_id: 444,
        target_column_title: "Program Department",
        target_column_type: "PICKLIST",
        label: "Academic unit",
        field_type: "select",
        settings_json: { options: ["Arts", "Sciences"] },
      },
    ]);
  });

  it("refreshes same-id reviewer mappings when Postgres returns BIGINT ids as strings", () => {
    const updates = planFieldConfigReconciliation(
      [
        {
          id: "fc-1",
          source_column_id: "444",
          source_column_title: "Old Title",
          display_label: "Old Title",
        },
      ],
      [{ id: 444, title: "New Title", type: "TEXT_NUMBER" }]
    );

    expect(updates).toEqual([
      {
        id: "fc-1",
        source_column_id: 444,
        source_column_title: "New Title",
        display_label: "New Title",
      },
    ]);
  });
});
