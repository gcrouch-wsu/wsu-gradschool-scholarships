import { createSignedIntakeFileUrl } from "@/lib/intake";
import type { SmartsheetAttachment } from "@/lib/smartsheet";

export type MergedAttachmentSource =
  | "smartsheet"
  | "intake_upload_pending"
  | "intake_upload_failed"
  | "intake_upload_blob_only"
  | "reviewer_upload";

export interface IntakeFileForMerge {
  id: string;
  original_filename: string;
  attachment_sync_status: string;
  smartsheet_attachment_id: string | number | null;
}

export interface MergedAttachment {
  id: string;
  name: string;
  url: string | undefined;
  source: MergedAttachmentSource;
  mimeType: string;
  syncStatus?: string;
  isFallback?: boolean;
}

/**
 * Merge Smartsheet row FILE attachments with intake submission files (mirror-aware).
 */
export function mergeIntakeWithSmartsheetAttachments(
  smartsheetAttachments: SmartsheetAttachment[],
  intakeFiles: IntakeFileForMerge[]
): MergedAttachment[] {
  const consumedSmartsheetIds = new Set<number>();
  const merged: MergedAttachment[] = [];

  for (const file of intakeFiles) {
    const st = file.attachment_sync_status;
    if (st === "not_applicable") {
      merged.push({
        id: file.id,
        name: file.original_filename,
        url: createSignedIntakeFileUrl(file.id),
        source: "intake_upload_blob_only",
        mimeType: "application/pdf",
      });
      continue;
    }

    if (st === "synced" || st === "deleted_from_blob") {
      const sid =
        file.smartsheet_attachment_id != null
          ? typeof file.smartsheet_attachment_id === "string"
            ? parseInt(file.smartsheet_attachment_id, 10)
            : Number(file.smartsheet_attachment_id)
          : NaN;
      const match =
        Number.isFinite(sid) && smartsheetAttachments.find((a) => a.id === sid);
      if (match) {
        consumedSmartsheetIds.add(match.id);
        merged.push({
          id: String(match.id),
          name: match.name,
          url: match.url,
          source: "smartsheet",
          mimeType: match.mimeType || "application/pdf",
        });
        continue;
      }
      merged.push({
        id: file.id,
        name: file.original_filename,
        url: createSignedIntakeFileUrl(file.id),
        source: "intake_upload_pending",
        mimeType: "application/pdf",
        syncStatus: st,
        isFallback: true,
      });
      continue;
    }

    if (st === "permanent_failed") {
      merged.push({
        id: file.id,
        name: file.original_filename,
        url: createSignedIntakeFileUrl(file.id),
        source: "intake_upload_failed",
        mimeType: "application/pdf",
        syncStatus: st,
      });
      continue;
    }

    merged.push({
      id: file.id,
      name: file.original_filename,
      url: createSignedIntakeFileUrl(file.id),
      source: "intake_upload_pending",
      mimeType: "application/pdf",
      syncStatus: st,
    });
  }

  for (const a of smartsheetAttachments) {
    if (consumedSmartsheetIds.has(a.id)) continue;
    merged.push({
      id: String(a.id),
      name: a.name,
      url: a.url,
      source: "smartsheet",
      mimeType: a.mimeType || "application/pdf",
    });
  }

  return merged;
}
