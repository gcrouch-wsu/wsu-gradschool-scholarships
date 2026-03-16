# UI/UX Audit — WSU Scholarship Review Platform

**Audited by:** Claude (acting as professional UI/UX auditor)
**Scope:** Full reviewer flow + admin cycle management
**Files reviewed:** All pages and components in `src/app/reviewer/`, `src/app/admin/`, and key shared components
**Impact ratings:** Critical / High / Medium / Low

---

## Executive Summary

The platform is architecturally solid and functionally correct. The reviewer experience is close to usable for a beta, but has two critical gaps: the page title never shows the nominee's name, and the Save button disables itself after saving with no auto-reset. The admin setup flow lacks any sequential guidance, making it hard for a first-time admin to know what to do in what order. Visual design is consistent in palette and spacing but has a split between crimson (login/scholarships pages) and near-black (reviewer form buttons) as the primary action color, which undermines brand coherence. Microcopy is functional but uses technical jargon in places that will confuse non-developer admins.

---

## 1. Reviewer Experience

### 1.1 Sign-in

**What works:**
- Clean centered card layout, correct field order (email → password → submit)
- WSU Crimson button with `disabled:opacity-50` during submission
- Redirect-after-login preserved in query param
- `must_change_password` redirect handled before rendering any content

**Issues:**

| # | Issue | Impact |
|---|---|---|
| R-1 | No "Forgot password" link or reset flow visible to reviewers | High |
| R-2 | Focus ring on inputs uses `focus:ring-zinc-500`, not WSU Crimson — inconsistent with the branding on the button | Low |
| R-3 | Error message is plain `text-red-600` inline text; no icon, no container — easy to miss | Medium |

---

### 1.2 My Scholarships (Reviewer Dashboard)

**File:** `src/app/reviewer/page.tsx`

**What works:**
- Correct empty state message when no active cycles
- Role label visible in each card
- Auto-focus redirect to last-viewed nominee when entering a cycle

**Issues:**

| # | Issue | Impact |
|---|---|---|
| R-4 | **No progress indicator on the dashboard.** Cards show program/cycle/role but no "X of Y reviewed" or completion status. A reviewer with 30 nominees has no sense of where they stand without clicking in. | High |
| R-5 | No personalization — no greeting, no name. The page feels like a generic list, not a personal dashboard. | Low |
| R-6 | Cards are single-line text blocks with no visual hierarchy between program name and metadata. Cycle key, deadline (if applicable), and nominee count would all be useful. | Medium |
| R-7 | All cycles look identical regardless of state (not started, in progress, complete). There is no visual differentiation to guide attention. | Medium |

**Recommendation for R-4 / R-7:** Add a completion ratio (e.g., "12 / 30 reviewed") and a narrow progress bar to each cycle card. Use `user_cycle_progress` which is already tracked. Color the bar in `colors.accent`.

---

### 1.3 Nominee List / Navigation

**File:** `src/app/reviewer/[cycleId]/page.tsx`

**What works:**
- Smart auto-redirect to last-viewed nominee using `user_cycle_progress`
- Graceful error states for unconfigured cycles and no nominees

**Issues:**

| # | Issue | Impact |
|---|---|---|
| R-8 | **No list view for reviewers.** The cycle page immediately redirects to the first/last nominee. There is no way to see all nominees, jump to a specific one, or filter by completion state. "Back to list" in the form navigates back to this page, which redirects again. Reviewers cannot navigate non-linearly. | Critical |
| R-9 | Error and configuration states return raw `<p>` text with no icon, no card container, and no CTA. | Low |

**Recommendation for R-8:** Before redirecting, render an intermediate nominee list page with each nominee's identity fields and a completion indicator (scored/unscored). This is especially important for longer review cycles. The redirect shortcut can remain for single-nominee cycles or as a "resume" button.

---

### 1.4 Nominee Review Page Shell

**File:** `src/app/reviewer/[cycleId]/nominees/[rowId]/page.tsx`

**Issues:**

| # | Issue | Impact |
|---|---|---|
| R-10 | **Page title is always "Review nominee" — the nominee's name never appears.** The `<h1>` is hardcoded. The actual nominee identity fields are only rendered after the client component fetches and loads data. An admin using a screen reader or browser tab has no context about who they are reviewing. | Critical |
| R-11 | "As [role label]" is `text-sm text-zinc-500 mt-1` — useful context but visually very weak. It is the only indicator of the reviewer's role on the page. | Low |
| R-12 | Breadcrumb "← Program – Cycle" navigates back to the cycle page, which immediately redirects to the last nominee. The reviewer cannot reach a list view from the breadcrumb. This is a dead loop. | High |

**Recommendation for R-10:** Pass the nominee identity (e.g., first/last name from the identity-purpose field) as a server-side prop if available from the row API, or at minimum update `<title>` dynamically from the client component using `document.title`.

---

### 1.5 Reviewer Score Form

**File:** `src/app/reviewer/[cycleId]/nominees/[rowId]/ReviewerScoreForm.tsx`

**What works:**
- Pinned header card above tabs — correct pattern, renders real row values
- Tab active state styled with `colors.accent` — good
- `loadedAt` timestamp shown subtly at bottom
- `Save & Next` auto-advances to next nominee
- Unsaved changes indicator ("Unsaved changes" in amber)

**Issues:**

| # | Issue | Impact |
|---|---|---|
| R-13 | **Save button stays disabled after saving and does not auto-reset.** `saveState === "saved"` disables both Save and Save & Next. If the reviewer wants to re-edit and save again, they must click Refresh to re-enable the button. This is a broken interaction. | Critical |
| R-14 | **No position indicator.** The form knows `nomineeIds` (the full list) and `rowId` (the current one), but never displays "Nominee X of Y". The reviewer has no sense of progress or position in the queue. | High |
| R-15 | **No progress bar.** Related to R-14. Even a simple `<progress>` element would significantly improve the sense of workflow completion. | High |
| R-16 | **Save buttons are not sticky.** On a long narrative record, the save actions scroll off screen. The reviewer must scroll to the bottom to save. | High |
| R-17 | **"Save & Next" is styled as a secondary (outlined) button, but is the primary action.** In a review workflow, advancing is the goal. It should be the filled/primary button. The plain "Save" should be secondary. | Medium |
| R-18 | **"Refresh" in the action bar is ambiguous.** Placed next to Save, it reads as "refresh this save" rather than "reload the row data". Label could be "Reload data" or "Discard changes". | Medium |
| R-19 | **"Save & Next" is disabled after saving.** If a reviewer saves, then wants to advance, the button is disabled. They must use the "Next →" link at the bottom. Two separate navigation mechanisms for the same action. | High |
| R-20 | **No keyboard shortcut for Save & Next.** In high-volume review tools, Ctrl+Enter or Alt+→ for "save and advance" is expected. | Medium |
| R-21 | **Loading state is plain text** ("Loading…" in zinc-500). On a slow network this looks broken rather than loading. No spinner, no skeleton layout. | Medium |
| R-22 | **No empty state within a tab section.** If a tab has no fields assigned to it (misconfiguration), the tab panel renders blank with no message. | Low |
| R-23 | **Prev/Next navigation is at the bottom of the form**, below the action bar. A reviewer who has saved and wants to navigate must scroll past save buttons to reach navigation links. | Medium |

**Fix for R-13 (Save button stays disabled):**
```tsx
// After setSaveState("saved"), add a reset timer:
setSaveState("saved");
setTimeout(() => setSaveState("idle"), 2500);
```

**Fix for R-14/R-15 (Position indicator):**
```tsx
const currentIndex = nomineeIds.indexOf(rowId);
// In JSX, above the tabs:
{nomineeIds.length > 0 && currentIndex >= 0 && (
  <div className="flex items-center gap-3">
    <span className="text-sm text-zinc-500">
      Nominee {currentIndex + 1} of {nomineeIds.length}
    </span>
    <div className="h-1.5 flex-1 rounded-full bg-zinc-200">
      <div
        className="h-1.5 rounded-full transition-all"
        style={{ width: `${((currentIndex + 1) / nomineeIds.length) * 100}%`, backgroundColor: colors.accent }}
      />
    </div>
  </div>
)}
```

---

## 2. Visual Design

### 2.1 Color Consistency

| # | Issue | Impact |
|---|---|---|
| D-1 | **Split primary action color.** Login page and Scholarships admin list use `bg-[var(--wsu-crimson)]` for primary buttons. The reviewer score form and field builder use `bg-zinc-900`. These are both "primary" buttons but look completely different. Pick one and apply it consistently. | High |
| D-2 | Non-tabbed layout branches in `ReviewerScoreForm` and `PreviewScoreForm` use hardcoded `bg-white` instead of `colors.cardBg`. If an admin sets a custom card background, it only applies to the tabbed layout. | Medium |
| D-3 | Focus ring color on login inputs (`focus:ring-zinc-500`) does not match the WSU Crimson brand. Should be `focus:ring-[var(--wsu-crimson)]`. | Low |

**Recommendation for D-1:** Standardize on `bg-[var(--wsu-crimson)]` for all primary actions across admin and reviewer. The `bg-zinc-900` style is used in the builder and reviewer form — update those to crimson. This is one global find-replace.

---

### 2.2 Typography and Hierarchy

| # | Issue | Impact |
|---|---|---|
| D-4 | Pinned card field labels use `text-[10px]` — extremely small. At 10px these may fail WCAG AA contrast requirements (4.5:1 minimum) on white or near-white backgrounds. | High |
| D-5 | Page-level `<h1>` is `text-2xl font-semibold` throughout — consistent and correct. Section `<h2>` uses `text-lg font-medium` — good hierarchy. | Positive |
| D-6 | Read-only field labels in the reviewer form use `text-xs font-medium text-zinc-500`. Field values use `text-zinc-900`. This contrast ratio (zinc-500 on white) is approximately 4.6:1 — marginal WCAG AA pass, may fail at small sizes. | Medium |

---

### 2.3 Component Consistency

| # | Issue | Impact |
|---|---|---|
| D-7 | Button border-radius inconsistency: login button is `rounded-md`, most other buttons are `rounded`. Visually these differ. | Low |
| D-8 | Error messages have two styles: inline `text-red-600` (login, inline form errors) vs `bg-red-50 border-red-200 text-red-900` (form-level errors). Standardize on the bordered box style for all errors — it is far more visible. | Medium |
| D-9 | Status badges (active/draft) are consistent across admin pages — good. | Positive |
| D-10 | Hover states on nav links use `hover:text-[var(--wsu-crimson)]` — consistent with branding. | Positive |

---

## 3. Admin Experience

### 3.1 Cycle Setup Flow

**File:** `src/app/admin/scholarships/[id]/cycles/[cycleId]/page.tsx`

The cycle detail page is the hub for all setup. An admin must complete roughly 9 steps in order:

1. Connect to Smartsheet (Connections page — not linked from here)
2. Select a connection and enter Sheet ID
3. Import schema
4. Configure fields & layout (builder)
5. Publish config
6. Assign reviewers
7. Activate cycle (Active toggle)

None of these steps are numbered, sequenced, or indicated as prerequisites. All sections appear simultaneously regardless of completion state.

| # | Issue | Impact |
|---|---|---|
| A-1 | **No setup checklist or progress indicator.** A new admin landing on a draft cycle sees all sections at once with no indication of what order to follow. | Critical |
| A-2 | **"Import schema" is blocked until a connection and Sheet ID are entered, but there is no inline guidance** — the button just disables (`disabled={syncing || !connId || !sheetIdInput}`). No tooltip or microcopy explains why. | High |
| A-3 | **"Sheet ID" is a raw number input with no help link.** Most admins do not know where to find a Smartsheet sheet ID. A "How to find this?" link or tooltip would eliminate a likely support request. | High |
| A-4 | **`CloneConfigForm`, `ApplyTemplateForm`, `ExportImportConfig`, and `SchemaDriftWarning` appear between the connection card and the Fields section** with no visual container, heading, or grouping. They float on the page without clear purpose to a new admin. | Medium |
| A-5 | **"Blind review" toggle is conditionally hidden** until the builder has been configured (`viewConfigs.length > 0`). There is no explanation of why it is absent. An admin configuring a new cycle will not see this option and may not realize it exists. | High |
| A-6 | **Toggles (Active, Blind review, External reviewers) are plain `<input type="checkbox">` elements** styled inline. For settings with significant consequences (making a cycle live, hiding nominee names), a larger toggle switch with a confirm dialog on the Active toggle would be more appropriate. | Medium |
| A-7 | **No confirmation dialog before activating a cycle.** Clicking "Active" immediately makes the cycle live for all assigned reviewers. An accidental check mid-configuration sends reviewers into an unconfigured cycle. | High |
| A-8 | **"Publish" button is styled as a ghost/secondary button** (`border border-zinc-300 px-3 py-1`). Publishing is a consequential, non-reversible action (without a rollback UI) and should be visually primary or at minimum have a confirmation prompt. | Medium |
| A-9 | **"Published" state shows green text but no timestamp.** When was the config published? Has it been edited since? There is no "unpublished changes" indicator. | Medium |
| A-10 | **No rollback or unpublish UI.** If a config is published with an error, there is no way to revert to a previous version without database access. | High |

**Recommendation for A-1:** Add a setup checklist at the top of a draft cycle page:

```
[ ] 1. Connect a Smartsheet
[ ] 2. Import schema (columns)
[ ] 3. Configure fields & layout
[ ] 4. Publish configuration
[ ] 5. Assign reviewers
[ ] 6. Activate cycle
```

Each step checks conditions (sheet_id set, field_configs exist, published_config_version_id set, memberships > 0, status = active) and renders as complete/incomplete. This alone would eliminate most admin confusion.

---

### 3.2 Field Builder

**File:** `src/app/admin/scholarships/[id]/cycles/[cycleId]/builder/FieldMappingBuilder.tsx`

The builder was the primary focus of the `claude_review.md` audit and has been substantially improved. This section covers remaining UX gaps not addressed in that document.

| # | Issue | Impact |
|---|---|---|
| A-11 | **No visible save confirmation after saving the builder.** The "Save" button in the builder likely shows a brief state change, but there is no toast or persistent "Saved at [time]" indicator. | Medium |
| A-12 | **"Publish" is on the cycle detail page, not in the builder.** A first-time admin who saves the builder and returns to the cycle page may not notice the Publish button — it is in the "Fields & layout" section next to two other links with the same visual weight. | High |
| A-13 | **The builder has no direct "Publish & return" action.** The workflow is: save builder → go back → click Publish → confirm. Each step requires navigating away. | Medium |

---

### 3.3 Reviewer Assignment

**File:** `AssignReviewerForm.tsx`

| # | Issue | Impact |
|---|---|---|
| A-14 | **User dropdown shows `Last, First (email)` for all users in one flat select.** On a large university installation this list could have hundreds of entries. There is no search, no filter, and no grouping. | High |
| A-15 | **No bulk assignment.** Adding 15 reviewers requires 15 form submissions. | Medium |
| A-16 | **No role filtering on the user list.** All active users appear regardless of whether they have the expertise for a given role. | Low |

---

## 4. Professional Polish

### 4.1 Loading States

| # | Issue | Impact |
|---|---|---|
| P-1 | Loading state in `ReviewerScoreForm` is `<div className="mt-6 text-zinc-500">Loading…</div>` — no spinner, no skeleton. On a 500ms load this is fine; on a 3s load it looks broken. | Medium |
| P-2 | The header layout (pinned card, tab bar) is not shown during load. There is no skeleton that would orient the reviewer to the page structure while data fetches. | Low |

### 4.2 Empty States

| # | Issue | Impact |
|---|---|---|
| P-3 | "No nominees in this cycle" is plain text with no icon or action. | Low |
| P-4 | "You are not assigned to any active scholarship cycles" — correct message, no icon or CTA, no explanation of who to contact. | Low |
| P-5 | Empty tab content (no fields assigned to a section) renders a blank panel with no message. | Low |

### 4.3 Responsiveness

| # | Issue | Impact |
|---|---|---|
| P-6 | `max-w-6xl` wrapper is good. `flex flex-wrap` in forms handles mobile gracefully. | Positive |
| P-7 | Admin nav bar has 6+ items on one line (Scholarships, Users, Audit, Settings, Connections, Name, Logout). On a 768px tablet this wraps badly or overflows. | Medium |
| P-8 | Reviewer action bar (Save, Save & Next, Refresh, "Unsaved changes", Back to list) on a single `flex flex-wrap items-center gap-3` row — wraps on mobile but the visual order is unpredictable when wrapped. | Low |

### 4.4 Accessibility

| # | Issue | Impact |
|---|---|---|
| P-9 | Read-only fields in the reviewer form use `<div>` elements with no ARIA role. Screen readers see unlabeled text blocks. Should use `role="group"` with `aria-labelledby` pointing to the label element, or convert to `<dl>/<dt>/<dd>` pairs. | High |
| P-10 | Pinned card header values have no ARIA labels — visual layout only. | Medium |
| P-11 | Toggle checkboxes (Active, Blind review, External reviewers) have labels via `<label>` wrapping — correct. | Positive |
| P-12 | Button disabled states use `disabled:opacity-50` — visible but may not meet contrast requirements. No `aria-disabled` on non-button elements. | Low |
| P-13 | No `aria-live` region for save state feedback. Screen readers do not announce "Saved", "Saving…", or error messages. | High |
| P-14 | The `<details>/<summary>` pattern used for "Rename cycle" is keyboard accessible natively — correct. | Positive |

---

## 5. Microcopy Audit

| Location | Current | Suggested | Impact |
|---|---|---|---|
| Cycle connection | "Sheet ID" | "Smartsheet Sheet ID" + help link | High |
| Cycle connection | "Import schema" | "Sync columns from Smartsheet" | Medium |
| Cycle connection | "Schema synced [date]" | "Columns last synced [date]" | Low |
| Builder save | (no post-save message) | "Saved at [time]" persistent indicator | Medium |
| Reviewer page title | "Review nominee" | "[Nominee name]" | Critical |
| Reviewer breadcrumb | "← Program – Cycle" | "← All nominees" | High |
| Reviewer action bar | "Refresh" | "Reload data" | Medium |
| Reviewer action bar | "Back to list" | (correct — once a list exists) | — |
| Active toggle | "Active (reviewers can see this cycle)" | (correct — clear label) | Positive |
| Blind review toggle | "Blind review (hide nominee names to reduce bias)" | (correct — clear label) | Positive |
| Publish button | "Publish" | "Publish to reviewers" | Low |
| Published state | "Published" | "Published — [date]" | Medium |
| Error (inline) | "An error occurred" | Specific message where possible | Medium |

---

## 6. Ranked Issue List

### Critical (fix before beta launch)

| ID | Description |
|---|---|
| R-8 | No nominee list view — "Back to list" leads to a redirect loop |
| R-10 | Page title always "Review nominee" — nominee name never shown |
| R-13 | Save button stays disabled after saving — blocks re-editing |
| A-1 | No setup checklist on new cycle — admins don't know where to start |

### High

| ID | Description |
|---|---|
| R-4 | No progress indicator on reviewer dashboard (X of Y reviewed) |
| R-12 | Breadcrumb from nominee page creates dead loop, no list reachable |
| R-14 | No "Nominee X of Y" position indicator in the review form |
| R-15 | No progress bar in review form |
| R-16 | Save buttons not sticky — scroll off screen on long forms |
| R-19 | Save & Next stays disabled after save — two mechanisms for same action |
| D-1 | Primary button color split between crimson and zinc-900 |
| D-4 | Pinned card labels at `text-[10px]` may fail WCAG contrast |
| A-2 | Import schema button disabled with no explanation |
| A-3 | Sheet ID input has no help link or guidance |
| A-5 | Blind review toggle hidden until builder configured, no explanation |
| A-7 | No confirmation before activating a cycle (makes it live immediately) |
| A-10 | No config rollback or unpublish UI |
| A-12 | Publish button visually buried next to two equal-weight links |
| A-14 | Flat user dropdown for reviewer assignment — no search |
| P-9 | Read-only fields not accessible to screen readers |
| P-13 | No `aria-live` for save state feedback |

### Medium

| ID | Description |
|---|---|
| R-3 | Login error messages too subtle |
| R-6 | Cycle cards lack useful metadata (nominee count, deadline) |
| R-7 | All cycle cards look identical regardless of completion state |
| R-17 | Save & Next should be primary button, Save secondary |
| R-18 | "Refresh" label is ambiguous next to save buttons |
| R-20 | No keyboard shortcut for Save & Next |
| R-21 | Loading state is plain text, no spinner or skeleton |
| D-2 | Non-tabbed layout uses hardcoded `bg-white` ignoring `colors.cardBg` |
| D-8 | Two error message styles — standardize on bordered box |
| A-6 | Consequential toggles are plain checkboxes, not switch components |
| A-8 | Publish button styled as ghost/secondary despite being consequential |
| A-9 | "Published" shows no timestamp or "unpublished changes" indicator |
| A-11 | No post-save confirmation in the builder |
| A-13 | No "Publish & return" action in the builder |
| A-15 | No bulk reviewer assignment |
| P-7 | Admin nav bar overflows on tablet |
| P-10 | Pinned card header values have no ARIA labels |

### Low

| ID | Description |
|---|---|
| R-1 | No forgot password link for reviewers |
| R-2 | Login focus ring color is zinc, not crimson |
| R-5 | No personalization on reviewer dashboard |
| R-9 | Error states in cycle page are plain text |
| R-11 | "As [role]" label is visually very small |
| R-22 | Empty tab panel renders blank with no message |
| D-3 | Login focus ring should be crimson |
| D-6 | Read-only label contrast marginal (zinc-500 on white) |
| D-7 | Button border-radius inconsistency (rounded vs rounded-md) |
| P-1 | Loading state could use a spinner |
| P-3 | Empty states lack icons or CTAs |
| P-4 | "Not assigned" state lacks contact/next-step guidance |
| P-5 | Empty tab content renders blank panel |
| P-8 | Action bar wrap order unpredictable on mobile |
| P-12 | `disabled:opacity-50` may not meet contrast |
| A-16 | Role filtering absent from user assignment dropdown |

---

## 7. Quick Wins (Low effort, high visibility)

These can be implemented in a short session and immediately improve the beta experience:

1. **Fix Save button auto-reset** (R-13) — one `setTimeout` call, 5 minutes
2. **Add "Nominee X of Y" above the pinned card** (R-14) — 15 lines of JSX
3. **Add a simple progress bar** (R-15) — pairs with R-14, same area
4. **Add timestamp to "Published" state** (A-9) — pass `published_at` through the query
5. **Add confirmation on Active toggle** (A-7) — one `window.confirm()` or a small modal
6. **Standardize primary button color to crimson** (D-1) — global find-replace in reviewer/builder files
7. **Update page `<title>` dynamically from the client form** (R-10) — one `useEffect(() => { document.title = nomineeNameField ?? "Review nominee" }, [fields])`
8. **Fix login focus ring** (D-3) — change `focus:ring-zinc-500` to `focus:ring-[var(--wsu-crimson)]`
