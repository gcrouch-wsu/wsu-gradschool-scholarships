import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { AssignReviewerForm } from "./AssignReviewerForm";
import { ApplyTemplateForm } from "./ApplyTemplateForm";
import { CloneConfigForm } from "./CloneConfigForm";
import { ExportImportConfig } from "./ExportImportConfig";
import { CycleSheetConfig } from "./CycleSheetConfig";
import { ExternalReviewersToggle } from "./ExternalReviewersToggle";
import { PublishConfigButton } from "./PublishConfigButton";
import { RemoveAssignmentButton } from "./RemoveAssignmentButton";
import { SchemaDriftWarning } from "./SchemaDriftWarning";

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

  const { rows: configVersions } = await query<{ id: string; version_number: number }>(
    "SELECT id, version_number FROM config_versions WHERE cycle_id = $1 ORDER BY version_number DESC LIMIT 1",
    [cycleId]
  );
  const { rows: cycleWithPublished } = await query<{ published_config_version_id: string | null }>(
    "SELECT published_config_version_id FROM scholarship_cycles WHERE id = $1",
    [cycleId]
  );

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
        <div className="mt-3">
          <ExternalReviewersToggle
            cycleId={cycleId}
            allowExternalReviewers={cycle.allow_external_reviewers}
          />
        </div>
      </div>

      {templateError && (
        <div className="mb-4 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Template could not be applied: {decodeURIComponent(templateError)}
        </div>
      )}

      <div className="space-y-6">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-medium text-zinc-900">
              Smartsheet connection
            </h2>
            <div className="flex items-center gap-4">
              <PublishConfigButton
                cycleId={cycleId}
                latestVersion={configVersions[0] ?? null}
                publishedVersionId={cycleWithPublished[0]?.published_config_version_id ?? null}
              />
              <Link
                href={`/admin/scholarships/${programId}/cycles/${cycleId}/builder`}
                className="text-sm font-medium text-zinc-600 hover:text-zinc-900"
              >
                Configure fields & layout →
              </Link>
            </div>
          </div>
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
