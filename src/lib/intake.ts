import { createHmac, timingSafeEqual } from "crypto";
import { head } from "@vercel/blob";
import { query, withTransaction } from "./db";
import { decrypt } from "./encryption";
import { addRow, getSheetSchema } from "./smartsheet";
import { logAudit } from "./audit";

export const runtime = "nodejs";

export const INTAKE_ALLOWED_FIELD_TYPES = [
  "short_text",
  "long_text",
  "email",
  "number",
  "select",
  "checkbox",
  "date",
  "file",
] as const;

export const INTAKE_ALLOWED_COLUMN_TYPES = [
  "TEXT_NUMBER",
  "PICKLIST",
  "DATE",
  "CHECKBOX",
] as const;

export const MAX_INTAKE_FILE_SIZE_BYTES = 104857600;

const DEV_HMAC_SECRET = "dev-secret";
const SUBMITTER_EMAIL_SUFFIX = "@wsu.edu";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_SIGNED_URL_TTL_MS = 5 * 60 * 1000;
const BLOB_FILENAME_SAFE_CHARS = /[^A-Za-z0-9._-]+/g;

type IntakeFieldType = (typeof INTAKE_ALLOWED_FIELD_TYPES)[number];
type IntakeColumnType = (typeof INTAKE_ALLOWED_COLUMN_TYPES)[number];
type SubmissionStatus =
  | "pending"
  | "processing"
  | "row_created"
  | "completed"
  | "failed"
  | "rate_limited"
  | "invalid_schema";

export interface PublishedIntakeField {
  field_key: string;
  label: string;
  help_text?: string | null;
  field_type: IntakeFieldType;
  required: boolean;
  sort_order?: number;
  target_column_id?: number | string | null;
  target_column_title?: string | null;
  target_column_type?: IntakeColumnType | string | null;
  settings_json?: Record<string, unknown> | null;
}

export interface PublishedIntakeSnapshot {
  title: string;
  instructions_text?: string | null;
  opens_at?: string | null;
  closes_at?: string | null;
  fields: PublishedIntakeField[];
}

interface UploadedFileInput {
  fieldKey: string;
  blobPathname?: string;
  blobUrl?: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
}

interface VerifiedUploadedFile {
  fieldKey: string;
  blobPathname: string;
  blobUrl: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
}

interface ValidationSuccess {
  ok: true;
  normalizedFields: Record<string, unknown>;
  normalizedFiles: VerifiedUploadedFile[];
}

interface ValidationFailure {
  ok: false;
  error: string;
}

type ValidationResult = ValidationSuccess | ValidationFailure;

interface ExistingSubmissionRow {
  id: string;
  status: SubmissionStatus;
  smartsheet_row_id: number | string | null;
  request_cells_json: Record<string, unknown> | null;
  request_files_json: UploadedFileInput[] | null;
}

type IntakeQueryFn = typeof query;

type SubmissionBootstrap =
  | { kind: "completed"; rowId: number | null }
  | { kind: "busy" }
  | {
      kind: "processing";
      id: string;
      smartsheetRowId: number | null;
      savedFields: Record<string, unknown> | null;
      savedFiles: UploadedFileInput[] | null;
    };

interface PgErrorLike {
  code?: string;
}

function getHmacKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("ENCRYPTION_KEY is required");
    }
    return DEV_HMAC_SECRET;
  }
  return key;
}

function signValue(value: string): string {
  return createHmac("sha256", getHmacKey()).update(value).digest("hex");
}

function safeCompareHex(expected: string, actual: string): boolean {
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAllowedFieldType(value: string): value is IntakeFieldType {
  return (INTAKE_ALLOWED_FIELD_TYPES as readonly string[]).includes(value);
}

function isAllowedColumnType(value: string): value is IntakeColumnType {
  return (INTAKE_ALLOWED_COLUMN_TYPES as readonly string[]).includes(value);
}

function getFieldOptions(field: PublishedIntakeField): string[] {
  const options = field.settings_json?.options;
  if (!Array.isArray(options)) return [];
  return options.filter((option): option is string => typeof option === "string");
}

function parseStoredRowId(value: number | string | null): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isUniqueViolation(error: unknown): error is PgErrorLike {
  return typeof error === "object" && error !== null && (error as PgErrorLike).code === "23505";
}

async function getExistingSubmission(
  submissionId: string,
  runQuery: IntakeQueryFn = query
): Promise<ExistingSubmissionRow | null> {
  const { rows } = await runQuery<ExistingSubmissionRow>(
    "SELECT id, status, smartsheet_row_id, request_cells_json, request_files_json FROM intake_submissions WHERE submission_id = $1",
    [submissionId]
  );
  return rows[0] ?? null;
}

async function toSubmissionBootstrap(
  existingSubmission: ExistingSubmissionRow,
  runQuery: IntakeQueryFn
): Promise<SubmissionBootstrap> {
  const existingRowId = parseStoredRowId(existingSubmission.smartsheet_row_id);

  if (existingSubmission.status === "completed") {
    return { kind: "completed", rowId: existingRowId };
  }

  if (existingSubmission.status === "processing") {
    return { kind: "busy" };
  }

  await runQuery(
    "UPDATE intake_submissions SET status = 'processing', updated_at = now() WHERE id = $1",
    [existingSubmission.id]
  );

  return {
    kind: "processing",
    id: existingSubmission.id,
    smartsheetRowId: existingRowId,
    savedFields: existingSubmission.request_cells_json,
    savedFiles: existingSubmission.request_files_json,
  };
}

function extractBlobPathname(value: string | undefined): string | null {
  if (!value) return null;
  if (!value.includes("://")) return value.replace(/^\/+/, "");
  try {
    const parsed = new URL(value);
    if (!parsed.hostname.endsWith(".blob.vercel-storage.com")) return null;
    return parsed.pathname.replace(/^\/+/, "");
  } catch {
    return null;
  }
}

function normalizeFileInput(value: unknown): UploadedFileInput | null {
  if (!isPlainObject(value)) return null;
  if (typeof value.fieldKey !== "string" || typeof value.originalFilename !== "string") {
    return null;
  }
  if (typeof value.contentType !== "string" || typeof value.sizeBytes !== "number") {
    return null;
  }

  return {
    fieldKey: value.fieldKey,
    blobPathname:
      typeof value.blobPathname === "string"
        ? value.blobPathname
        : extractBlobPathname(typeof value.blobUrl === "string" ? value.blobUrl : undefined) ?? undefined,
    blobUrl: typeof value.blobUrl === "string" ? value.blobUrl : undefined,
    originalFilename: value.originalFilename,
    contentType: value.contentType,
    sizeBytes: value.sizeBytes,
  };
}

function normalizeTextLikeValue(field: PublishedIntakeField, raw: unknown): ValidationFailure | { ok: true; value?: string } {
  if (raw === undefined || raw === null || raw === "") {
    if (field.required) {
      return { ok: false, error: `Field "${field.label}" is required` };
    }
    return { ok: true, value: raw === "" ? "" : undefined };
  }
  if (typeof raw !== "string") {
    return { ok: false, error: `Field "${field.label}" must be a string` };
  }
  if (field.required && raw.trim() === "") {
    return { ok: false, error: `Field "${field.label}" is required` };
  }
  return { ok: true, value: raw };
}

function normalizeFieldValue(field: PublishedIntakeField, raw: unknown): ValidationFailure | { ok: true; value?: unknown } {
  switch (field.field_type) {
    case "short_text":
    case "long_text":
      return normalizeTextLikeValue(field, raw);
    case "email": {
      const result = normalizeTextLikeValue(field, raw);
      if (!result.ok || result.value === undefined || result.value === "") return result;
      const value = String(result.value).trim().toLowerCase();
      if (!EMAIL_REGEX.test(value)) {
        return { ok: false, error: `Field "${field.label}" must be a valid email address` };
      }
      if (!value.endsWith(SUBMITTER_EMAIL_SUFFIX)) {
        return { ok: false, error: `Field "${field.label}" must end with ${SUBMITTER_EMAIL_SUFFIX}` };
      }
      return { ok: true, value };
    }
    case "number": {
      if (raw === undefined || raw === null || raw === "") {
        if (field.required) {
          return { ok: false, error: `Field "${field.label}" is required` };
        }
        return { ok: true, value: undefined };
      }
      const parsed = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(parsed)) {
        return { ok: false, error: `Field "${field.label}" must be numeric` };
      }
      return { ok: true, value: parsed };
    }
    case "select": {
      if (raw === undefined || raw === null || raw === "") {
        if (field.required) {
          return { ok: false, error: `Field "${field.label}" is required` };
        }
        return { ok: true, value: undefined };
      }
      if (typeof raw !== "string") {
        return { ok: false, error: `Field "${field.label}" must be a string` };
      }
      const options = getFieldOptions(field);
      if (!options.includes(raw)) {
        return { ok: false, error: `Field "${field.label}" contains an invalid selection` };
      }
      return { ok: true, value: raw };
    }
    case "checkbox": {
      if (raw === undefined) {
        if (field.required) {
          return { ok: false, error: `Field "${field.label}" must be checked` };
        }
        return { ok: true, value: false };
      }
      if (typeof raw !== "boolean") {
        return { ok: false, error: `Field "${field.label}" must be true or false` };
      }
      if (field.required && raw !== true) {
        return { ok: false, error: `Field "${field.label}" must be checked` };
      }
      return { ok: true, value: raw };
    }
    case "date": {
      if (raw === undefined || raw === null || raw === "") {
        if (field.required) {
          return { ok: false, error: `Field "${field.label}" is required` };
        }
        return { ok: true, value: undefined };
      }
      if (typeof raw !== "string" || !ISO_DATE_REGEX.test(raw)) {
        return { ok: false, error: `Field "${field.label}" must be an ISO date string` };
      }
      const parsed = new Date(`${raw}T00:00:00.000Z`);
      if (Number.isNaN(parsed.getTime())) {
        return { ok: false, error: `Field "${field.label}" must be a valid date` };
      }
      return { ok: true, value: raw };
    }
    case "file":
      return { ok: true, value: undefined };
  }
}

async function verifyUploadedFiles(args: {
  cycleId: string;
  submissionId: string;
  snapshot: PublishedIntakeSnapshot;
  files: unknown;
}): Promise<ValidationFailure | { ok: true; files: VerifiedUploadedFile[] }> {
  const fileInputs = Array.isArray(args.files)
    ? args.files.map(normalizeFileInput).filter((value): value is UploadedFileInput => value !== null)
    : [];

  if (Array.isArray(args.files) && fileInputs.length !== args.files.length) {
    return { ok: false, error: "One or more uploaded files are malformed" };
  }

  const fileFields = args.snapshot.fields.filter((field) => field.field_type === "file");
  const fileFieldsByKey = new Map(fileFields.map((field) => [field.field_key, field]));
  const seenKeys = new Set<string>();

  for (const file of fileInputs) {
    if (!fileFieldsByKey.has(file.fieldKey)) {
      return { ok: false, error: `Unexpected file upload for field "${file.fieldKey}"` };
    }
    if (seenKeys.has(file.fieldKey)) {
      return { ok: false, error: `Only one file is allowed for field "${file.fieldKey}"` };
    }
    seenKeys.add(file.fieldKey);
  }

  for (const field of fileFields) {
    if (field.required && !seenKeys.has(field.field_key)) {
      return { ok: false, error: `Field "${field.label}" requires a PDF upload` };
    }
  }

  const verifiedFiles: VerifiedUploadedFile[] = [];
  for (const file of fileInputs) {
    if (file.contentType !== "application/pdf") {
      return { ok: false, error: `Field "${file.fieldKey}" must be a PDF` };
    }
    if (file.sizeBytes > MAX_INTAKE_FILE_SIZE_BYTES) {
      return { ok: false, error: `Field "${file.fieldKey}" exceeds the 100 MB limit` };
    }
    if (!file.blobPathname) {
      return { ok: false, error: `Field "${file.fieldKey}" is missing blob metadata` };
    }

    const expectedPrefix = `intake/${args.cycleId}/${args.submissionId}/${file.fieldKey}/`;
    if (!file.blobPathname.startsWith(expectedPrefix)) {
      return { ok: false, error: `Field "${file.fieldKey}" has an invalid upload path` };
    }

    let blobMeta;
    try {
      blobMeta = await head(file.blobPathname, {
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
    } catch {
      return { ok: false, error: `Field "${file.fieldKey}" could not be verified in Blob storage` };
    }

    if (blobMeta.pathname !== file.blobPathname) {
      return { ok: false, error: `Field "${file.fieldKey}" failed blob pathname verification` };
    }
    if (blobMeta.contentType !== "application/pdf") {
      return { ok: false, error: `Field "${file.fieldKey}" is not stored as a PDF` };
    }
    if (blobMeta.size > MAX_INTAKE_FILE_SIZE_BYTES) {
      return { ok: false, error: `Field "${file.fieldKey}" exceeds the 100 MB limit` };
    }

    verifiedFiles.push({
      fieldKey: file.fieldKey,
      blobPathname: blobMeta.pathname,
      blobUrl: blobMeta.url,
      originalFilename: file.originalFilename,
      contentType: blobMeta.contentType,
      sizeBytes: blobMeta.size,
    });
  }

  return { ok: true, files: verifiedFiles };
}

export function sanitizeBlobFilename(filename: string): string {
  const trimmed = filename.trim();
  const fallback = "upload.pdf";
  if (!trimmed) return fallback;

  const lastDot = trimmed.lastIndexOf(".");
  const rawBase = lastDot > 0 ? trimmed.slice(0, lastDot) : trimmed;
  const rawExt = lastDot > 0 ? trimmed.slice(lastDot + 1) : "pdf";

  const base = rawBase.replace(BLOB_FILENAME_SAFE_CHARS, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "upload";
  const ext = rawExt.replace(/[^A-Za-z0-9]+/g, "").toLowerCase() || "pdf";

  return `${base}.${ext}`;
}

export function buildBlobPathname(
  cycleId: string,
  submissionId: string,
  fieldKey: string,
  filename: string
): string {
  return `intake/${cycleId}/${submissionId}/${fieldKey}/${sanitizeBlobFilename(filename)}`;
}

export function createSignedIntakeFileUrl(fileId: string, expiresAt = Date.now() + DEFAULT_SIGNED_URL_TTL_MS): string {
  const signature = signValue(`intake-file:${fileId}:${expiresAt}`);
  return `/api/intake-files/${fileId}?expires=${expiresAt}&signature=${signature}`;
}

export function verifySignedIntakeFileUrl(fileId: string, expiresAt: number, signature: string): boolean {
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;

  const expected = signValue(`intake-file:${fileId}:${expiresAt}`);
  return safeCompareHex(expected, signature.toLowerCase());
}

export function hashIp(ip: string): string {
  return signValue(ip);
}

/**
 * Check if the current IP has exceeded rate limits for a specific route.
 * 8.2: max 10 upload-token requests per IP per 15 minutes per cycle
 * 8.3: max 5 submit attempts per IP per 15 minutes per cycle
 * 8.3: max 25 submit attempts per IP per 24 hours per cycle
 */
export async function checkRateLimit(
  cycleId: string,
  ip: string,
  routeKey: "submit" | "upload-token"
): Promise<{ ok: boolean; error?: string }> {
  const ipHash = hashIp(ip);

  if (Math.random() < 0.01) {
    await query("DELETE FROM intake_rate_limit_events WHERE created_at < now() - interval '14 days'");
  }

  await query(
    "INSERT INTO intake_rate_limit_events (cycle_id, route_key, ip_hash) VALUES ($1, $2, $3)",
    [cycleId, routeKey, ipHash]
  );

  if (routeKey === "upload-token") {
    const { rows } = await query<{ count: string }>(
      "SELECT count(*) FROM intake_rate_limit_events WHERE cycle_id = $1 AND route_key = $2 AND ip_hash = $3 AND created_at > now() - interval '15 minutes'",
      [cycleId, routeKey, ipHash]
    );
    if (parseInt(rows[0]?.count ?? "0", 10) > 10) {
      return { ok: false, error: "Rate limit exceeded (10 requests / 15 mins)" };
    }
  } else {
    const { rows: shortRows } = await query<{ count: string }>(
      "SELECT count(*) FROM intake_rate_limit_events WHERE cycle_id = $1 AND route_key = $2 AND ip_hash = $3 AND created_at > now() - interval '15 minutes'",
      [cycleId, routeKey, ipHash]
    );
    if (parseInt(shortRows[0]?.count ?? "0", 10) > 5) {
      return { ok: false, error: "Rate limit exceeded (5 submissions / 15 mins)" };
    }

    const { rows: longRows } = await query<{ count: string }>(
      "SELECT count(*) FROM intake_rate_limit_events WHERE cycle_id = $1 AND route_key = $2 AND ip_hash = $3 AND created_at > now() - interval '24 hours'",
      [cycleId, routeKey, ipHash]
    );
    if (parseInt(longRows[0]?.count ?? "0", 10) > 25) {
      return { ok: false, error: "Rate limit exceeded (25 submissions / 24 hours)" };
    }
  }

  return { ok: true };
}

export async function validateSubmissionPayload(args: {
  cycleId: string;
  submissionId: string;
  submitterEmail: string;
  snapshot: PublishedIntakeSnapshot;
  fields: unknown;
  files: unknown;
}): Promise<ValidationResult> {
  if (!EMAIL_REGEX.test(args.submitterEmail) || !args.submitterEmail.toLowerCase().endsWith(SUBMITTER_EMAIL_SUFFIX)) {
    return { ok: false, error: `Submitter email must end with ${SUBMITTER_EMAIL_SUFFIX}` };
  }

  if (!isPlainObject(args.fields)) {
    return { ok: false, error: "Submission fields must be an object" };
  }

  const fieldMap = new Map(args.snapshot.fields.map((field) => [field.field_key, field]));
  for (const key of Object.keys(args.fields)) {
    if (!fieldMap.has(key)) {
      return { ok: false, error: `Unexpected field "${key}"` };
    }
  }

  const normalizedFields: Record<string, unknown> = {};
  for (const field of args.snapshot.fields) {
    if (!isAllowedFieldType(field.field_type)) {
      return { ok: false, error: `Published field "${field.label}" uses unsupported type "${field.field_type}"` };
    }

    if (field.field_type === "file") continue;

    const result = normalizeFieldValue(field, args.fields[field.field_key]);
    if (!result.ok) return result;
    if (result.value !== undefined) {
      normalizedFields[field.field_key] = result.value;
    }
  }

  const verifiedFiles = await verifyUploadedFiles({
    cycleId: args.cycleId,
    submissionId: args.submissionId,
    snapshot: args.snapshot,
    files: args.files,
  });

  if (!verifiedFiles.ok) return verifiedFiles;

  return {
    ok: true,
    normalizedFields,
    normalizedFiles: verifiedFiles.files,
  };
}

/**
 * 5.3 Live validation model: Validate Smartsheet schema at submit time.
 */
export async function validateLiveSchema(cycleId: string, publishedSnapshot: PublishedIntakeSnapshot) {
  const { rows: cycles } = await query<{ connection_id: string; sheet_id: number }>(
    "SELECT connection_id, sheet_id FROM scholarship_cycles WHERE id = $1",
    [cycleId]
  );
  const cycle = cycles[0];
  if (!cycle?.connection_id || !cycle.sheet_id) {
    throw new Error("Cycle connection not found during live validation");
  }

  const { rows: conn } = await query<{ encrypted_credentials: string }>(
    "SELECT encrypted_credentials FROM connections WHERE id = $1",
    [cycle.connection_id]
  );
  const encrypted = conn[0]?.encrypted_credentials;
  if (!encrypted) throw new Error("Connection credentials not found");

  const token = decrypt(encrypted);
  const schemaResult = await getSheetSchema(token, cycle.sheet_id);
  if (!schemaResult.ok || !schemaResult.sheet) {
    throw new Error(`Failed to fetch live Smartsheet schema: ${schemaResult.error}`);
  }

  const liveColumns = new Map(schemaResult.sheet.columns.map((column) => [String(column.id), column]));
  const fields = publishedSnapshot.fields || [];

  for (const field of fields) {
    if (!isAllowedFieldType(field.field_type)) {
      return { ok: false, error: `Field "${field.label}" uses unsupported type "${field.field_type}"` };
    }

    if (field.field_type === "file") continue;
    if (!field.target_column_id) {
      return { ok: false, error: `Field "${field.label}" is missing a target column mapping` };
    }

    const liveCol = liveColumns.get(String(field.target_column_id));
    if (!liveCol) {
      return { ok: false, error: `Mapped column "${field.target_column_title}" (ID: ${field.target_column_id}) missing in Smartsheet` };
    }

    if (!isAllowedColumnType(liveCol.type)) {
      return { ok: false, error: `Mapped column "${field.target_column_title}" uses unsupported type "${liveCol.type}"` };
    }

    if (liveCol.type !== field.target_column_type) {
      return {
        ok: false,
        error: `Mapped column "${field.target_column_title}" type mismatch. Expected ${field.target_column_type}, found ${liveCol.type}`,
      };
    }

    if (liveCol.locked) {
      return { ok: false, error: `Mapped column "${field.target_column_title}" is locked in Smartsheet` };
    }

    if (field.field_type === "select" && liveCol.type === "PICKLIST") {
      const fieldOptions = getFieldOptions(field);
      const liveOptions = new Set(liveCol.options ?? []);
      for (const option of fieldOptions) {
        if (!liveOptions.has(option)) {
          return {
            ok: false,
            error: `Mapped picklist column "${field.target_column_title}" no longer accepts option "${option}"`,
          };
        }
      }
    }
  }

  return { ok: true, token, sheetId: cycle.sheet_id };
}

async function markSubmissionFailure(submissionRowId: string, error: string, status: SubmissionStatus = "failed") {
  await query(
    "UPDATE intake_submissions SET status = $1, failure_json = $2, updated_at = now() WHERE id = $3",
    [status, JSON.stringify({ error }), submissionRowId]
  );
}

/**
 * 12. Idempotent submission processing.
 */
export async function processSubmission(params: {
  cycleId: string;
  submissionId: string;
  formVersionId: string;
  submitterEmail: string;
  fields: Record<string, unknown>;
  files: UploadedFileInput[];
  ip: string;
}) {
  const ipHash = hashIp(params.ip);

  let submission: SubmissionBootstrap;
  try {
    submission = await withTransaction(async (tx): Promise<SubmissionBootstrap> => {
      const existingSubmission = await getExistingSubmission(params.submissionId, tx);
      if (existingSubmission) {
        return toSubmissionBootstrap(existingSubmission, tx);
      }

      const { rows: forms } = await tx<{ id: string }>(
        "SELECT id FROM intake_forms WHERE cycle_id = $1",
        [params.cycleId]
      );
      if (forms.length === 0) throw new Error("Intake form not found for cycle");

      const { rows: inserted } = await tx<{ id: string }>(
        `INSERT INTO intake_submissions (
          submission_id, cycle_id, intake_form_id, intake_form_version_id,
          submitter_email, status, request_cells_json, request_files_json, ip_hash
        ) VALUES ($1, $2, $3, $4, $5, 'processing', $6, $7, $8)
        RETURNING id`,
        [
          params.submissionId,
          params.cycleId,
          forms[0].id,
          params.formVersionId,
          params.submitterEmail,
          JSON.stringify(params.fields),
          JSON.stringify(params.files),
          ipHash,
        ]
      );

      return {
        kind: "processing",
        id: inserted[0].id,
        smartsheetRowId: null,
        savedFields: null,
        savedFiles: null,
      };
    });
  } catch (err) {
    if (!isUniqueViolation(err)) {
      throw err;
    }

    const existingSubmission = await getExistingSubmission(params.submissionId);
    if (!existingSubmission) {
      throw err;
    }

    submission = await toSubmissionBootstrap(existingSubmission, query);
  }

  if (submission.kind === "completed") {
    return { success: true, rowId: submission.rowId, status: 200 };
  }

  if (submission.kind === "busy") {
    return {
      success: false,
      error: "Submission is already being processed. Please retry shortly.",
      status: 409,
    };
  }

  try {
    const { rows: versions } = await query<{ snapshot_json: PublishedIntakeSnapshot }>(
      "SELECT snapshot_json FROM intake_form_versions WHERE id = $1",
      [params.formVersionId]
    );
    const snapshot = versions[0]?.snapshot_json;
    if (!snapshot) throw new Error("Form version not found");

    const candidateFields =
      submission.savedFields && Object.keys(submission.savedFields).length > 0
        ? submission.savedFields
        : params.fields;
    const candidateFiles =
      submission.savedFiles && submission.savedFiles.length > 0
        ? submission.savedFiles
        : params.files;

    const payloadValidation = await validateSubmissionPayload({
      cycleId: params.cycleId,
      submissionId: params.submissionId,
      submitterEmail: params.submitterEmail,
      snapshot,
      fields: candidateFields,
      files: candidateFiles,
    });

    if (!payloadValidation.ok) {
      await markSubmissionFailure(submission.id, payloadValidation.error);
      return { success: false, error: payloadValidation.error, status: 400 };
    }

    await query(
      "UPDATE intake_submissions SET request_cells_json = $1, request_files_json = $2, updated_at = now() WHERE id = $3",
      [
        JSON.stringify(payloadValidation.normalizedFields),
        JSON.stringify(payloadValidation.normalizedFiles),
        submission.id,
      ]
    );

    const liveVal = await validateLiveSchema(params.cycleId, snapshot);
    if (!liveVal.ok) {
      const schemaError = liveVal.error || "Live schema validation failed";
      await markSubmissionFailure(submission.id, schemaError, "invalid_schema");
      await query(
        "UPDATE intake_forms SET status = 'invalid', updated_at = now() WHERE cycle_id = $1",
        [params.cycleId]
      );
      await logAudit({
        cycleId: params.cycleId,
        actionType: "intake.schema_drift_detected",
        targetType: "intake_form",
        metadata: { error: schemaError, submissionId: params.submissionId },
      });
      return { success: false, error: "Form is temporarily unavailable due to schema drift", status: 503 };
    }

    let rowId = submission.smartsheetRowId;
    if (!rowId) {
      const cells: Array<{ columnId: number; value: unknown; strict?: boolean }> = [];
      for (const field of snapshot.fields || []) {
        if (field.field_type === "file" || !field.target_column_id) continue;
        if (!(field.field_key in payloadValidation.normalizedFields)) continue;

        cells.push({
          columnId: parseInt(String(field.target_column_id), 10),
          value: payloadValidation.normalizedFields[field.field_key],
          ...(field.target_column_type === "PICKLIST" ? { strict: true } : {}),
        });
      }

      const addResult = await addRow(liveVal.token!, liveVal.sheetId!, cells);
      if (!addResult.ok) {
        if (addResult.httpStatus === 429 || addResult.errorCode === 4003) {
          await query(
            "UPDATE intake_submissions SET status = 'rate_limited', failure_json = $1, updated_at = now() WHERE id = $2",
            [JSON.stringify({ error: "Smartsheet rate limit exceeded" }), submission.id]
          );
          return { success: false, error: "Smartsheet rate limit exceeded", status: 429 };
        }
        throw new Error(addResult.error || "Failed to create Smartsheet row");
      }

      rowId = addResult.rowId ?? null;
      await query(
        "UPDATE intake_submissions SET status = 'row_created', smartsheet_row_id = $1, updated_at = now() WHERE id = $2",
        [rowId, submission.id]
      );
    }

    const requiredFileCount = payloadValidation.normalizedFiles.length;
    if (requiredFileCount > 0) {
      const { rows: existingFiles } = await query<{ field_key: string }>(
        "SELECT field_key FROM intake_submission_files WHERE submission_id = $1",
        [params.submissionId]
      );
      const existingFieldKeys = new Set(existingFiles.map((file) => file.field_key));

      for (const file of payloadValidation.normalizedFiles) {
        if (existingFieldKeys.has(file.fieldKey)) continue;

        await query(
          `INSERT INTO intake_submission_files (
            submission_id, cycle_id, field_key, blob_url, blob_pathname,
            original_filename, content_type, size_bytes, smartsheet_row_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            params.submissionId,
            params.cycleId,
            file.fieldKey,
            file.blobUrl,
            file.blobPathname,
            file.originalFilename,
            file.contentType,
            file.sizeBytes,
            rowId,
          ]
        );
        existingFieldKeys.add(file.fieldKey);
      }

      if (existingFieldKeys.size !== requiredFileCount) {
        throw new Error("Not all uploaded files were persisted for this submission");
      }
    }

    await query(
      "UPDATE intake_submissions SET status = 'completed', completed_at = now(), updated_at = now() WHERE id = $1",
      [submission.id]
    );

    return { success: true, rowId, status: 201 };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await markSubmissionFailure(submission.id, errorMsg);
    throw err;
  }
}
