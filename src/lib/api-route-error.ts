import { NextResponse } from "next/server";

export function pgErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Map unhandled DB/API errors to a JSON body so clients never see an empty response.
 */
export function jsonErrorFromUnknown(error: unknown, logLabel: string): NextResponse {
  const code = pgErrorCode(error);
  if (code === "42703") {
    return NextResponse.json(
      {
        error:
          "Database schema is missing a required column (for example `push_to_smartsheet` on `intake_form_fields`). Apply `supabase/migrations/010_smartsheet_attachment_sync.sql`, then retry.",
      },
      { status: 500 }
    );
  }

  console.error(`[${logLabel}]`, error);
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Internal server error";
  return NextResponse.json({ error: message || "Internal server error" }, { status: 500 });
}
