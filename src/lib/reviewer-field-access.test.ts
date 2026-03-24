import { describe, expect, it } from "vitest";
import {
  getReviewerRoleFields,
  getVisibleReviewerRoleFields,
  isReviewerAttachmentField,
  readReviewerVisibilitySettings,
} from "./reviewer-field-access";

describe("reviewer field access helpers", () => {
  it("hides blind-marked fields and removes edit access", () => {
    const fields = [
      {
        id: "field-1",
        field_key: "prospectus",
        source_column_id: 101,
        purpose: "comments",
        display_type: "textarea",
        help_text: null,
      },
    ];
    const permissions = [
      {
        field_config_id: "field-1",
        role_id: "role-1",
        can_view: true,
        can_edit: true,
      },
    ];

    const roleFields = getReviewerRoleFields(fields, permissions, "role-1", {
      hiddenFieldKeys: ["prospectus"],
    });

    expect(roleFields).toEqual([
      expect.objectContaining({
        id: "field-1",
        can_edit: false,
        hidden_by_blind_review: true,
      }),
    ]);
    expect(getVisibleReviewerRoleFields(roleFields)).toEqual([]);
  });

  it("leaves role editability intact when a field is not blind-hidden", () => {
    const fields = [
      {
        id: "field-1",
        field_key: "score_1",
        source_column_id: 102,
        purpose: "score",
        display_type: "score_select",
        help_text: null,
      },
    ];
    const permissions = [
      {
        field_config_id: "field-1",
        role_id: "role-1",
        can_view: true,
        can_edit: true,
      },
    ];

    const roleFields = getReviewerRoleFields(fields, permissions, "role-1", {});

    expect(roleFields).toEqual([
      expect.objectContaining({
        id: "field-1",
        can_edit: true,
        hidden_by_blind_review: false,
      }),
    ]);
  });

  it("detects attachment fields and reads visibility settings defensively", () => {
    expect(
      readReviewerVisibilitySettings({
        hiddenFieldKeys: ["field_a", 123, null],
      })
    ).toEqual({
      hiddenFieldKeys: ["field_a"],
    });

    expect(
      isReviewerAttachmentField({
        purpose: "attachment",
        display_type: "attachment_list",
      })
    ).toBe(true);
    expect(
      isReviewerAttachmentField({
        purpose: "metadata",
        display_type: "short_text",
      })
    ).toBe(false);
  });
});
