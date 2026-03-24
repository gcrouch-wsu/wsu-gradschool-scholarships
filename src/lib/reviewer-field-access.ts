import type {
  ReviewerFieldConfigRecord,
  ReviewerPermissionRecord,
} from "./reviewer-config";

type ReviewerFieldLike = Pick<
  ReviewerFieldConfigRecord,
  "id" | "field_key" | "source_column_id" | "purpose" | "display_type" | "help_text"
>;

export interface ReviewerVisibilitySettings {
  blindReview: boolean;
  hiddenFieldKeys: string[];
}

export type ReviewerEffectiveRoleField<TField extends ReviewerFieldLike = ReviewerFieldConfigRecord> =
  TField & {
    can_edit: boolean;
    hidden_by_blind_review: boolean;
  };

export function readReviewerVisibilitySettings(
  settingsJson: unknown
): ReviewerVisibilitySettings {
  if (!settingsJson || typeof settingsJson !== "object") {
    return { blindReview: false, hiddenFieldKeys: [] };
  }

  const settings = settingsJson as {
    blindReview?: unknown;
    hiddenFieldKeys?: unknown;
  };

  return {
    blindReview: settings.blindReview === true,
    hiddenFieldKeys: Array.isArray(settings.hiddenFieldKeys)
      ? settings.hiddenFieldKeys.filter(
          (fieldKey): fieldKey is string => typeof fieldKey === "string"
        )
      : [],
  };
}

export function getReviewerRoleFields<TField extends ReviewerFieldLike>(
  fieldConfigs: TField[],
  permissions: ReviewerPermissionRecord[],
  roleId: string,
  settingsJson: unknown
): ReviewerEffectiveRoleField<TField>[] {
  const { blindReview, hiddenFieldKeys } =
    readReviewerVisibilitySettings(settingsJson);
  const hiddenFieldKeySet = new Set(hiddenFieldKeys);
  const permissionByFieldId = new Map(
    permissions
      .filter(
        (permission) =>
          permission.role_id === roleId && permission.can_view === true
      )
      .map((permission) => [permission.field_config_id, permission])
  );

  return fieldConfigs.flatMap((fieldConfig) => {
    const permission = permissionByFieldId.get(fieldConfig.id);
    if (!permission) {
      return [];
    }

    const hiddenByBlindReview =
      blindReview && hiddenFieldKeySet.has(fieldConfig.field_key);

    return [
      {
        ...fieldConfig,
        can_edit: hiddenByBlindReview ? false : permission.can_edit === true,
        hidden_by_blind_review: hiddenByBlindReview,
      },
    ];
  });
}

export function getVisibleReviewerRoleFields<
  TField extends { hidden_by_blind_review: boolean },
>(fieldConfigs: TField[]): TField[] {
  return fieldConfigs.filter((fieldConfig) => !fieldConfig.hidden_by_blind_review);
}

export function isReviewerAttachmentField(fieldConfig: {
  purpose: string;
  display_type: string;
}): boolean {
  return (
    fieldConfig.purpose === "attachment" ||
    fieldConfig.display_type === "attachment_list"
  );
}
