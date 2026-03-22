import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { AssignReviewerForm } from "./AssignReviewerForm";
import { ApplyTemplateForm } from "./ApplyTemplateForm";
import { CloneConfigForm } from "./CloneConfigForm";
import { ExportImportConfig } from "./ExportImportConfig";
import { CycleSheetConfig } from "./CycleSheetConfig";
import { BlindReviewToggle } from "./BlindReviewToggle";
import { CycleStatusToggle } from "./CycleStatusToggle";
import { ExternalReviewersToggle } from "./ExternalReviewersToggle";
import { PublishConfigButton } from "./PublishConfigButton";
import { RemoveAssignmentButton } from "./RemoveAssignmentButton";
import { SchemaDriftWarning } from "./SchemaDriftWarning";
import { RenameCycleForm } from "./RenameCycleForm";
import { DeleteCycleButton } from "./DeleteCycleButton";

function SetupStep({
  done,
  children,
}: {
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className={`flex items-start gap-2 ${done ? "text-zinc-600" : "text-zinc-900"}`}>
      <span className="mt-0.5 shrink-0 font-medium" aria-hidden>
        {done ? "✓" : "○"}
      </span>
      <span>{children}</span>
    </li>
  );
}

export default async function CycleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; cycleId: string }>;
  searchParams: Promise<{ templateError?: string }>;
}) {
  const { id: programId, cycleId } = await params;
  const { templateError } = await searchParams;
  const user = await getSessionUser();
  if (!user) return null;
  const { canManageCycle } = await import("@/lib/admin");
  const canManage = await canManageCycle(user.id, user.is_platform_admin, cycleId);
  if (!canManage) {
    return (
      <div className="text-zinc-600">
        You do not have permission to view this cycle.
      </div>
    );
  }

  const { rows: programCycles } = await query<{
    id: string;
    cycle_key: string;
    cycle_label: string;
  }>(
    "SELECT id, cycle_key, cycle_label FROM scholarship_cycles WHERE program_id = $1 ORDER BY cycle_label DESC",
    [programId]
  );

  const { rows: cycles } = await query<{
    id: string;
    program_id: string;
    cycle_key: string;
    cycle_label: string;
    status: string;
    connection_id: string | null;
    sheet_id: number | null;
    sheet_name: string | null;
    schema_synced_at: string | null;
    allow_external_reviewers: boolean;
  }>(
    `SELECT id, program_id, cycle_key, cycle_label, status, connection_id, sheet_id, sheet_name, schema_synced_at, allow_external_reviewers
     FROM scholarship_cycles WHERE id = $1 AND program_id = $2`,
    [cycleId, programId]
  );
  const cycle = cycles[0];
  if (!cycle) notFound();

  const { rows: program } = await query<{ name: string }>(
    "SELECT name FROM scholarship_programs WHERE id = $1",
    [programId]
  );

  const { rows: connections } = await query<{ id: string; name: string }>(
    user.is_platform_admin
      ? "SELECT id, name FROM connections WHERE status = 'active' ORDER BY name"
      : "SELECT id, name FROM connections WHERE status = 'active' AND program_id = $1 ORDER BY name",
    user.is_platform_admin ? [] : [programId]
  );

  const { rows: roles } = await query<{ id: string; key: string; label: string }>(
    "SELECT id, key, label FROM roles WHERE cycle_id = $1 ORDER BY sort_order",
    [cycleId]
  );

  const { rows: allUsersRaw } = await query<{
    id: string;
    email: string;
    first_name: string;
    last_name: string;
  }>(
    "SELECT id, email, first_name, last_name FROM users WHERE status = 'active' ORDER BY last_name, first_name"
  );
  const allowedDomain = (
    process.env.ALLOWED_REVIEWER_EMAIL_DOMAIN || "wsu.edu"
  ).toLowerCase();
  const allUsers =
    cycle.allow_external_reviewers
      ? allUsersRaw
      : allUsersRaw.filter(
          (u) => (u.email || "").toLowerCase().split("@")[1] === allowedDomain
        );

  const { rows: memberships } = await query<{
    user_id: string;
    email: string;
    first_name: string;
    last_name: string;
    role_label: string;
  }>(
    `SELECT m.user_id, u.email, u.first_name, u.last_name, r.label as role_label
     FROM scholarship_memberships m
     JOIN users u ON u.id = m.user_id
     JOIN roles r ON r.id = m.role_id
     WHERE m.cycle_id = $1 AND m.status = 'active'
     ORDER BY u.last_name, u.first_name`,
    [cycleId]
  );

  const { rows: latestConfig } = await query<{ id: string }>(
    "SELECT id FROM config_versions WHERE cycle_id = $1 ORDER BY version_number DESC LIMIT 1",
    [cycleId]
  );
  const { rows: cycleWithPublished } = await query<{
    published_config_version_id: string | null;
    published_at: string | null;
  }>(
    `SELECT c.published_config_version_id, cv.published_at
     FROM scholarship_cycles c
     LEFT JOIN config_versions cv ON cv.id = c.published_config_version_id
     WHERE c.id = $1`,
    [cycleId]
  );

  const { rows: viewConfigs } = await query<{ settings_json: unknown }>(
    "SELECT settings_json FROM view_configs WHERE cycle_id = $1 LIMIT 1",
    [cycleId]
  );
  const { rows: fieldConfigs } = await query<{ id: string }>(
    "SELECT id FROM field_configs WHERE cycle_id = $1 LIMIT 1",
    [cycleId]
  );

  const { rows: intakeForms } = await query<{
    status: string;
    published_version_id: string | null;
    updated_at: string;
  }>(
    "SELECT status, published_version_id, updated_at FROM intake_forms WHERE cycle_id = $1",
    [cycleId]
  );
  const intakeForm = intakeForms[0];

  const viewSettings = viewConfigs[0]?.settings_json as { blindReview?: boolean } | null;
  const blindReview = viewSettings?.blindReview ?? false;
  const isCycleActive = cycle.status === "active";

  return (
    <div>
      <div className="mb-6">
        <Link
          href={`/admin/scholarships/${programId}`}
          className="text-sm text-zinc-600 hover:underline"
        >
          ← {program[0]?.name ?? "Program"}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-900">
          {cycle.cycle_label} ({cycle.cycle_key})
        </h1>
        <div className="mt-2 flex gap-2">
          <span
            className={`rounded px-2 py-1 text-xs font-medium ${
              cycle.status === "active"
                ? "bg-green-100 text-green-800"
                : cycle.status === "draft"
                  ? "bg-amber-100 text-amber-800"
                  : "bg-zinc-100 text-zinc-600"
            }`}
          >
            {cycle.status}
          </span>
          {cycle.sheet_name && (
            <span className="text-sm text-zinc-500">
              Sheet: {cycle.sheet_name}
            </span>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <CycleStatusToggle cycleId={cycleId} status={cycle.status} />
          {viewConfigs.length > 0 ? (
            <BlindReviewToggle cycleId={cycleId} blindReview={blindReview} />
          ) : (
            <span className="text-sm text-zinc-500" title="Configure fields & layout first">
              Blind review (configure fields first)
            </span>
          )}
          <ExternalReviewersToggle
            cycleId={cycleId}
            allowExternalReviewers={cycle.allow_external_reviewers}
          />
          <details className="rounded border border-zinc-200 bg-white">
            <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
              Rename cycle
            </summary>
            <div className="border-t border-zinc-200 p-3">
              <RenameCycleForm
                cycleId={cycleId}
                programId={programId}
                currentKey={cycle.cycle_key}
                currentLabel={cycle.cycle_label}
              />
            </div>
          </details>
          <DeleteCycleButton
            cycleId={cycleId}
            programId={programId}
            cycleLabel={cycle.cycle_label}
          />
        </div>
      </div>

      {templateError && (
        <div className="mb-4 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Template could not be applied: {decodeURIComponent(templateError)}
        </div>
      )}

      {cycle.status === "draft" && (
        <div className="mb-6 rounded-lg border border-zinc-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-zinc-900">Setup checklist</h2>
          <ol className="space-y-2 text-sm">
            <SetupStep done={!!(cycle.connection_id && cycle.sheet_id)}>
              1. Connect a Smartsheet (select connection and enter Sheet ID below)
            </SetupStep>
            <SetupStep done={!!cycle.schema_synced_at}>
              2. Import schema (sync columns from Smartsheet)
            </SetupStep>
            <SetupStep done={intakeForm?.status === "published"}>
              3. Build intake form (optional — skip if using external intake)
            </SetupStep>
            <SetupStep done={fieldConfigs.length > 0}>
              4. Configure fields & layout (map columns, set labels, publish)
            </SetupStep>
            <SetupStep done={!!cycleWithPublished[0]?.published_config_version_id}>
              5. Publish configuration (make it live for reviewers)
            </SetupStep>
            <SetupStep done={memberships.length > 0}>
              6. Assign reviewers
            </SetupStep>
            <SetupStep done={isCycleActive}>
              7. Activate cycle (reviewers can see it)
            </SetupStep>
          </ol>
        </div>
      )}

      <div className="space-y-6">
        <section>
          <h2 className="mb-3 text-lg font-medium text-zinc-900">
            Smartsheet connection
          </h2>
          <CycleSheetConfig
            cycleId={cycleId}
            connectionId={cycle.connection_id}
            sheetId={cycle.sheet_id}
            sheetName={cycle.sheet_name}
            schemaSyncedAt={cycle.schema_synced_at}
            connections={connections}
          />
          <CloneConfigForm cycleId={cycleId} sourceCycles={programCycles} />
          <ApplyTemplateForm cycleId={cycleId} />
          <ExportImportConfig cycleId={cycleId} isPlatformAdmin={user.is_platform_admin} />
          <SchemaDriftWarning cycleId={cycleId} />
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white p-5">
          <h2 className="text-lg font-medium text-zinc-900">
            Nomination intake form
          </h2>
          <p className="mt-1 text-sm text-zinc-600">
            Build a public-facing form to collect nominations directly into your Smartsheet.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <Link
              href={`/admin/scholarships/${programId}/cycles/${cycleId}/intake-form`}
              className="inline-flex items-center gap-2 rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              {intakeForm ? "Edit intake form" : "Build intake form"}
              <span aria-hidden>→</span>
            </Link>
            {intakeForm && (
              <div className="flex items-center gap-2 text-sm">
                <span className={`font-medium ${
                  intakeForm.status === "published" ? "text-green-700" : "text-zinc-500"
                }`}>
                  Status: {intakeForm.status}
                </span>
                {intakeForm.status === "published" && (
                  <Link
                    href={`/submit/${cycleId}`}
                    target="_blank"
                    className="text-blue-600 hover:underline"
                  >
                    View live form
                  </Link>
                )}
              </div>
            )}
          </div>
          {intakeForm?.published_version_id && (
            <div className="mt-4 rounded bg-zinc-50 p-3">
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Public URL</div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <code className="break-all text-sm">{`${process.env.NEXT_PUBLIC_APP_URL || ""}/submit/${cycleId}`}</code>
                {/* Note: In a real browser we would use navigator.clipboard, but for now we just show it */}
              </div>
            </div>
          )}
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white p-5">
          <h2 className="text-lg font-medium text-zinc-900">
            Fields & layout (what reviewers see)
          </h2>
          <p className="mt-1 text-sm text-zinc-600">
            Map Smartsheet columns to fields, set labels, visibility, and edit permissions per role. Drag to reorder. Save your changes, then publish to make them live for reviewers.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link
              href={`/admin/scholarships/${programId}/cycles/${cycleId}/builder`}
              className="inline-flex items-center gap-2 rounded-md bg-[var(--wsu-crimson)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--wsu-crimson-hover)]"
            >
              Configure fields & layout
              <span aria-hidden>→</span>
            </Link>
            <Link
              href={`/admin/scholarships/${programId}/cycles/${cycleId}/preview`}
              className="inline-flex items-center gap-2 rounded border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Preview as reviewer
            </Link>
            <PublishConfigButton
              cycleId={cycleId}
              latestConfigId={latestConfig[0]?.id ?? null}
              publishedConfigId={cycleWithPublished[0]?.published_config_version_id ?? null}
              publishedAt={cycleWithPublished[0]?.published_at ?? null}
            />
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-medium text-zinc-900">
            Assigned reviewers
          </h2>
          <AssignReviewerForm
            cycleId={cycleId}
            roles={roles}
            users={allUsers}
            existingUserIds={memberships.map((m) => m.user_id)}
          />
          {memberships.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-500">No reviewers assigned yet.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {memberships.map((m) => (
                <li
                  key={m.user_id}
                  className="flex items-center justify-between rounded border border-zinc-200 bg-white px-4 py-2"
                >
                  <span>
                    {m.first_name} {m.last_name} ({m.email})
                  </span>
                  <span className="text-sm text-zinc-500">{m.role_label}</span>
                  <RemoveAssignmentButton cycleId={cycleId} userId={m.user_id} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
