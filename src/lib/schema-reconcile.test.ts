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
        },
      ],
      [
        { id: 222, title: "Score", type: "PICKLIST" },
        { id: 333, title: "score", type: "TEXT_NUMBER" },
      ]
    );

    expect(updates).toEqual([]);
  });

  it("refreshes intake mappings to the current title and type", () => {
    const updates = planIntakeFieldReconciliation(
      [
        {
          id: "iff-1",
          target_column_id: 444,
          target_column_title: "Student Name",
          target_column_type: "TEXT_NUMBER",
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
      },
    ]);
  });
});
