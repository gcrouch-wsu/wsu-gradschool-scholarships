# Scholarship Review Platform — Build Assessment

Reviewed: 2026-03-15
Reviewer: Claude (claude-sonnet-4-6)
Reference: handoff.MD

---

## Executive Summary

The platform is functionally complete and structurally sound against all handoff-specified features. Security boundaries between platform admins, scholarship admins, and reviewers are correctly enforced at the API layer with no privilege-escalation paths found. One genuine bug was identified that was not previously documented: the schema-drift check flags virtual attachment fields (column ID 0) as perpetually drifted, creating a false alarm on every cycle that uses attachment fields. All other gaps are pre-acknowledged in the handoff. The platform is one small fix away from clean internal-pilot readiness.

---

## Handoff Compliance — Per-Area Checklist

### Connection Scoping

| Check | Status | Notes |
|---|---|---|
| GET /api/admin/connections scopes by program for scholarship admins | Pass | `program_id IN (SELECT ... FROM program_admins WHERE user_id=$1)` |
| Connection POST is platform-admin only | Pass | Hard gate, `is_platform_admin` only |
| programId validated before insert | Pass | 400 on unknown program |
| Cycles PATCH validates connection is assigned to cycle's program | Pass | `connections WHERE id=$1 AND program_id=$2`, 403 if not found |
| Schema route requires cycleId for scholarship admins + validates connection-program binding | Pass | Three-step guard: canManageCycle, program lookup, connection-program check |
| Connection PATCH (program-assign) verifies connection and program exist before update | Pass | 404 on unknown connection; 400 on unknown program |
| Cycle detail page scopes UI connection picker | Pass | Server renders `WHERE program_id=$1` for scholarship admins |

### Attachment Access

| Check | Status | Notes |
|---|---|---|
| Attachments API checks membership | Pass | `scholarship_memberships JOIN scholarship_cycles` |
| Attachments API checks field_permissions (can_view on attachment field) | Pass | Returns 403 if no matching field_permissions row |
| Attachment is virtual field (source_column_id = 0) | Pass | Builder stores 0; import-config defaults to 0 for attachment purpose |
| Config route excludes attachment fields from validFields | Pass | Explicit filter: `purpose !== "attachment" && display_type !== "attachment_list"` |
| Token stays server-side throughout | Pass | No credential returned to client anywhere |
| `showAttachments` flag derived from role-permitted fields | Pass | Checked against `field_permissions.can_view = true` |

### Config Lifecycle

| Check | Status | Notes |
|---|---|---|
| Builder save wrapped in withTransaction | Pass | Full snapshot + config_version inside same transaction |
| Clone-config wrapped in withTransaction | Pass | Delete-copy-snapshot-version all atomic; same-program check present |
| Import-config wrapped in withTransaction | Pass | config_version created inside transaction |
| Template apply creates config_version | Pass | AddCycleForm → import-config endpoint |
| Publish: all prior versions demoted to superseded | Pass | `UPDATE config_versions SET status='superseded' WHERE id != $2` |
| Publish: cycle.published_config_version_id updated | Pass | — |
| Publish wrapped in withTransaction | Fail | Three sequential UPDATE queries; no rollback on partial failure |

### Admin Boundaries

| Check | Status | Notes |
|---|---|---|
| Template GET (list + by ID) requires canAccessAdmin | Pass | Both routes enforce this |
| Template POST requires is_platform_admin | Pass | Hard gate |
| "Save as template" UI gated by isPlatformAdmin prop | Pass | ExportImportConfig receives `isPlatformAdmin` and conditionally renders button |
| Audit log (GET) is platform admin only | Pass | Hard gate |
| App config GET/PATCH platform admin only | Pass | Hard gate; PATCH validates numeric ranges |
| Connection rotate/test platform admin only | Pass | Hard gate |
| Program admin add/remove platform admin only + audited | Pass | All three verbs gated |
| Cycle creation platform admin only + audited | Pass | `is_platform_admin` only |
| Audit filter includes app_config.updated, cycle.config_imported, template.created | Pass | All emitted by their respective routes |

### WSU-Only Reviewer Policy

| Check | Status | Notes |
|---|---|---|
| Assignments POST enforces email domain when allow_external_reviewers=false | Pass | Domain extracted from email; 400 with descriptive message |
| ALLOWED_REVIEWER_EMAIL_DOMAIN env var respected (default wsu.edu) | Pass | Both UI and API use the env var |
| Cycle page user picker scoped to allowed domain | Pass | Server-side filter: `email.split('@')[1] === allowedDomain` |

### Audit Coverage

| Check | Status | Notes |
|---|---|---|
| connection.created / rotated / program_assigned | Pass | — |
| cycle.created / updated / config_cloned / config_imported / config_updated / config_published | Pass | — |
| assignment.created / removed | Pass | — |
| program_admin.added / removed | Pass | — |
| template.created | Pass | Added in 2026-03-15 fixes |
| app_config.updated | Pass | — |
| reviewer.score_saved with before/after cell values | Pass | — |
| Audit failures swallowed silently (try/catch → console.error) | Note | Acceptable but invisible if logs aren't monitored |

### Security Model

| Check | Status | Notes |
|---|---|---|
| Tokens encrypted AES-256-GCM with scrypt KDF | Pass | `encryption.ts` — correct IV/tag/key derivation |
| Tokens never returned to client | Pass | No route exposes encrypted_credentials or plaintext |
| Session cookies: httpOnly, secure in production, sameSite lax | Pass | — |
| DB-backed sessions with revocation | Pass | revoked_at and status = 'active' check |
| Sliding window session extension | Pass | expires_at updated on every request |
| All DB queries parameterized | Pass | No string interpolation in SQL values |
| Live schema validation before reviewer exposure | Pass | getLiveColumnIds() gating in row GET and POST |
| Field edit permissions enforced server-side in reviewer POST | Pass | editableIds derived from field_permissions; filtered against liveColumnIds |
| Middleware provides page-level redirect for unauthenticated requests | Pass | — |
| Middleware does NOT enforce auth on API routes | Note | By design; documented as pending proxy migration |

---

## Critical Issues — Must Fix Before Pilot

None that block the core reviewer workflow. See Recommendations for the schema-drift bug that should be fixed before any pilot cycles use attachment fields.

---

## Recommendations — Should Fix

### 1. Schema drift false positive for virtual attachment fields

**File:** `src/app/api/admin/cycles/[id]/schema-drift/route.ts:34`

The drift check fetches all `field_configs` and tests each against `liveColumnIds`. Attachment fields have `source_column_id = 0`. Smartsheet column IDs are large integers; `0` will never appear in the live schema, so `liveColumnIds.has(0)` is always `false`. Any cycle with an attachment field will show a persistent "drifted column" warning, even though the field is working correctly.

The query needs a filter:

```sql
-- Add to the WHERE clause:
AND fc.source_column_id != 0
```

Or equivalently filter in TypeScript after the query on `f.source_column_id !== 0`. This is a one-line fix.

### 2. Publish-config should run in a transaction

**File:** `src/app/api/admin/cycles/[id]/publish-config/route.ts`

Three sequential UPDATE queries (supersede old versions → update cycle pointer → mark latest published) are not wrapped in `withTransaction`. If steps 2 or 3 fail after step 1 succeeds, old versions are marked superseded but the cycle pointer is stale or the latest version is still `draft`. Very unlikely in practice but easy to fix by wrapping all three in `withTransaction`.

---

## Minor Notes — Non-Blocking

1. **`getAdminProgramIds` type mismatch** (`src/lib/admin.ts:8`): The return type declares `Promise<"all" | string[]>` but the function only ever returns `string[]`. The `"all"` branch was presumably planned but not implemented. No callers rely on it. Misleading type documentation only.

2. **Duplicate `cycleId` null-check in assignments route** (`src/app/api/admin/assignments/route.ts:15-34`): `cycleId` is checked for truthiness at line 15-17 then again at line 22-34. The second `!cycleId` branch is dead code after the first check. No impact.

3. **`displayName` logic is duplicated and divergent**: The reviewer rows list route (`rows/route.ts:90-95`) has hardcoded fallback keys `"name"`, `"title"`, `"Applicant Name"`. The `getReviewerNominees` function in `reviewer.ts:88-91` uses the first non-empty identity field value instead. The rows route doesn't call `getReviewerNominees`; it has its own parallel implementation. Could cause inconsistent display names if refactored.

4. **`must_change_password` enforcement**: The field is correctly stored and returned by `getSessionUser`. The middleware does not redirect to `/change-password`, which per the handoff is by design (layout-level enforcement). Confirm that the admin and reviewer layouts enforce the redirect for `must_change_password = true` users — this was not verified in this assessment.

5. **Attachment URLs in response are pre-signed Smartsheet URLs**: They expire per `urlExpiresInMillis` and are served to authorized reviewers only. This is the correct Smartsheet attachment model.

---

## Readiness Verdict

**Needs one fix, then ready for internal pilot.**

The platform's security architecture is sound with no access-control bypasses or token exposure paths. All handoff-specified features are implemented. The only new finding beyond what the handoff already documents is the schema-drift false positive for attachment fields — a one-line fix. If pilot cycles will not use attachment fields, the platform can be considered ready now. If attachment fields will be used, fix the drift route first.

---

## What Looks Solid

- **Permission model end-to-end**: Every API route enforces auth via `getSessionUser()` → `canManageCycle()` / `canManageProgram()` / `canAccessAdmin()`. No shortcut paths observed.
- **Transaction discipline**: Builder save, clone-config, and import-config are all correctly wrapped in `withTransaction`. The snapshot reads that feed into `config_versions` are inside the same transaction, preventing stale snapshots.
- **Token isolation**: Smartsheet tokens are encrypted at rest (AES-256-GCM + scrypt), decrypted only in server-side route handlers, and never serialized into any API response. The connections list endpoint returns only `{id, name, provider, status, last_verified_at}`.
- **Attachment permission depth**: Attachment access control is enforced at two independent layers — the config route computes `showAttachments = false` if the role has no view permission on attachment fields, and the attachments API endpoint independently re-verifies the same permission gate. Defense in depth.
- **WSU-only policy**: The email domain check is enforced server-side in the assignments route. UI filtering is applied on top of, not instead of, the API enforcement.
- **Config versioning**: All four paths that produce a new config (builder save, clone, import, template-apply) correctly create a `config_versions` row inside their transaction. Publish correctly supersedes all prior versions.
- **Audit completeness**: All significant admin actions and reviewer score saves produce audit log entries with before/after context where applicable.
- **Cycle isolation**: `canManageCycle` chains through `scholarship_cycles.program_id → program_admins` so scholarship admins can only reach cycles in their programs. Cross-program operations (clone-config) enforce `sourceCycle.program_id === targetCycle.program_id`.
