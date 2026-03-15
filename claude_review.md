# Field Mapping Builder — Review & Improvement Proposals (v5)

**File reviewed:** `src/app/admin/scholarships/[id]/cycles/[cycleId]/builder/FieldMappingBuilder.tsx`
**Related files:** `src/app/admin/scholarships/[id]/cycles/[cycleId]/builder/page.tsx`, `src/app/api/admin/cycles/[id]/builder/route.ts`, `src/app/api/admin/cycles/[id]/preview-config/route.ts`, `src/app/api/reviewer/cycles/[cycleId]/config/route.ts`, `src/app/reviewer/[cycleId]/nominees/[rowId]/ReviewerScoreForm.tsx`, `src/app/admin/scholarships/[id]/cycles/[cycleId]/preview/PreviewScoreForm.tsx`
**Reference project:** `C:\Python Projects\Vercel\wsu-gradschool-tools` (newsletter editor ColorPicker pattern)

---

## Reference: wsu-gradschool-tools

The `wsu-gradschool-tools` monorepo contains several Next.js apps (factsheet-editor, newsletter-editor, org-chart-editor, platform, translation-tables). The newsletter editor is the most relevant — it has:

- `components/ColorPicker.tsx`: a reusable color picker with a native `<input type="color">`, a hex text field, and a WSU palette dropdown with named swatches. Uses click-outside detection via `useRef`. Closes on selection.
- `components/SettingsEditor.tsx`: uses `ColorPicker` for accent bars, card shadows, dividers, and other configurable UI colors. Organized into collapsible sections (Layout & Structure, Card Styling, Content Padding).
- `WSU_COLORS` palette: Crimson `#A60F2D`, Dark Crimson `#8c0d25`, Gray `#4D4D4D`, Light Gray `#5E6A71`, Text Dark `#2A3033`, Text Body `#333333`, backgrounds, borders, and footer colors.

The newsletter editor uses custom Tailwind classes (`wsu-crimson`, `wsu-text-dark`, `wsu-border-light`, etc.) registered via its own `tailwind.config.ts`. The scholarship platform uses CSS custom properties (`--wsu-crimson`) registered in `globals.css` — a different but equivalent approach.

**What was adapted for the scholarship platform:**
- The WSU palette and ColorPicker pattern were ported inline into `FieldMappingBuilder.tsx` as a self-contained `ColorSwatch` component (no separate file needed, no external icon library since the platform has none).
- The palette was trimmed to 12 swatches (removed footer-specific entries not relevant to a review UI).

---

## Summary of Issues (Updated)

The builder has five distinct problems, two of which (pinned header fields and the empty preview) are blocking it from being a usable beta. The others are UX quality issues.

| # | Issue | Severity | Status |
|---|---|---|---|
| 1 | "Purpose" concept is not explained in terms the admin can act on | Medium | **Implemented** |
| 2 | No undo for purpose/label changes | Medium | **Implemented** |
| 3 | No way to pin fields to show on all tabs | High | **Implemented** |
| 4 | Preview shows no data content for any layout or purpose | High | **Implemented** |
| 5 | Score dropdowns in preview are empty even for PICKLIST columns | High | **Implemented (empty-state warning)** |
| 6 | No color controls for reviewer UI | Medium | **Implemented** |

---

## Issue 1 — The "Purpose" concept is confusing as presented

### What purpose actually does

The purpose field is not metadata about a column. It is a **rendering instruction** — it tells the reviewer UI what component to render for that field and whether the reviewer can edit it. Purpose drives everything downstream:

- `identity` → rendered as the large header/name at the top of the record
- `subtitle` → rendered as secondary text under the name
- `narrative` → rendered as read-only long text (essays, descriptions)
- `score` → rendered as a dropdown the reviewer selects from (editable, writes back to Smartsheet)
- `comments` → rendered as a free-text area the reviewer types into (editable, writes back)
- `metadata` → rendered as a small read-only label/value pair (dates, IDs, status)
- `attachment` → rendered as a file list

The current "Purpose reference" panel (proposed in v1 of this review) listed these descriptions but did not explain *why they matter* or *what they control*. An admin reading "Score: Reviewer picks from options — editable" still does not understand that this determines whether a field appears as an interactive dropdown or static text in the reviewer form.

### What to change

Rename the section or add a one-sentence explainer that frames purpose as a rendering decision, not a classification:

> **Purpose controls how this field appears to reviewers.** Identity and subtitle become the record header. Score and Comments fields are the only ones reviewers can edit — they write back to Smartsheet. Everything else is read-only.

Place this above the field table, not in a collapsible. The color coding in the purpose badge (blue = read-only, amber = editable) should reinforce this split visually.

---

## Issue 2 — No undo for purpose or label changes

### What happens now

`updateMapping(idx, updates)` overwrites the field in `mapped` state immediately. There is no history and no way to revert a change. If an admin accidentally changes a purpose from `score` to `metadata`, they must remember the original value and manually change it back.

### Proposed fix — lightweight undo stack

Add a `history` ref alongside the `mapped` state. Before every mutation, push the current `mapped` snapshot. Add an undo button to the toolbar.

```ts
const historyRef = useRef<MappedField[][]>([]);

function pushHistory(current: MappedField[]) {
  historyRef.current = [...historyRef.current.slice(-19), current];
}

function undo() {
  const prev = historyRef.current.pop();
  if (prev) setMapped(prev);
}
```

Call `pushHistory(mapped)` at the start of `updateMapping`, `removeMapping`, and `addColumn` before applying changes. Add an "Undo" button next to Save that is disabled when `historyRef.current.length === 0`.

This requires no API or data model changes — it is entirely local state.

### Secondary fix — reset to saved

On load, store the initial `mapped` in a `savedMapped` ref. Add a "Reset to saved" option that restores it. This covers the case where an admin has made multiple changes and wants to start over without reloading the page.

---

## Issue 3 — No pinned header card (fields that show on all tabs)

### What is missing

Every mapped field is assigned to exactly one tab via `sectionKey`. There is no way to designate fields like "First Name", "Last Name", or "Program" as always-visible context that appears above the tabs regardless of which tab is active.

This is a core UX pattern for any record-review application: the record identity is always visible at the top, and the tabs below are for detail views. Without it, reviewers must switch tabs to remember whose record they are looking at.

### What to build

Add a `pinned` boolean to `MappedField`. Pinned fields render in a persistent header card above the tab bar (and above any other layout). They are excluded from tab assignment — pinning replaces the tab dropdown for that row.

**Interface change:**
```ts
interface MappedField {
  // ... existing fields
  pinned?: boolean;
}
```

**In the field table row**, replace the Tab dropdown with a "Pinned to header" indicator when `m.pinned === true`. Add a toggle checkbox or button to the row:

```tsx
{viewType === "tabbed" && (
  m.pinned ? (
    <div className="flex items-center gap-1">
      <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] text-blue-700">
        Header card
      </span>
      <button
        type="button"
        onClick={() => updateMapping(idx, { pinned: false, sectionKey: sections[0]?.section_key })}
        className="text-[10px] text-zinc-400 hover:text-zinc-600"
      >
        unpin
      </button>
    </div>
  ) : (
    <div className="flex flex-col gap-1">
      <select
        value={m.sectionKey ?? sections[0]?.section_key ?? ""}
        onChange={(e) => updateMapping(idx, { sectionKey: e.target.value })}
        className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
      >
        {sections.map((s) => (
          <option key={s.section_key} value={s.section_key}>{s.label}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => updateMapping(idx, { pinned: true, sectionKey: undefined })}
        className="text-[10px] text-zinc-500 hover:text-zinc-700 text-left"
      >
        Pin to header instead
      </button>
    </div>
  )
)}
```

**In `LayoutPreview`**, render pinned fields in a card above all layouts:

```tsx
const pinnedFields = mapped.filter((m) => m.pinned);
const unpinnedMapped = mapped.filter((m) => !m.pinned);

// At the top of every layout variant:
{pinnedFields.length > 0 && (
  <div className="mb-3 rounded-lg border border-zinc-200 bg-white px-4 py-3">
    <div className="flex flex-wrap gap-x-6 gap-y-1">
      {pinnedFields.map((m) => (
        <div key={m.fieldKey}>
          <span className="block text-[10px] uppercase text-zinc-400">{m.displayLabel}</span>
          <span className="text-sm font-medium text-zinc-800">[{m.sourceColumnTitle}]</span>
        </div>
      ))}
    </div>
  </div>
)}
```

**Data model change required.** The `pinned` flag must be persisted. The simplest path is adding a `pinned` boolean column to `field_configs` (default false). Alternatively store it in a JSON settings field if schema migrations are costly. The POST handler in `route.ts` must accept and persist this value.

**Extensibility note.** The header card concept is not scholarship-specific. Any record-review application needs identity context above a tabbed or sectioned detail view. The `pinned` flag on `field_config` generalizes cleanly to other use cases.

---

## Issue 4 — Preview shows no content for any field purpose

### What happens now

`renderField` in `LayoutPreview` (lines 173–202) renders:
- A small purpose label in zinc-500
- The `displayLabel` in bold
- For `score`: a `<select>` (may be empty — see Issue 5)
- For `comments`: an empty `<textarea>`
- For everything else: **nothing**

Identity, subtitle, narrative, and metadata fields show only their label. There is no placeholder content, no sample value, no indication of what the reviewer will actually see. The preview looks identical for a one-line metadata field and a three-paragraph narrative essay.

### What the preview needs to show

The preview must communicate **how the data will be presented**, not just that a field exists. Add purpose-specific placeholder rendering in `renderField`:

```tsx
function renderField(m: MappedField) {
  const options = getOptionsForField(m);
  return (
    <div key={m.fieldKey} className="border-b border-zinc-100 pb-3 last:border-0">
      <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
        {m.displayLabel}
      </span>

      {m.purpose === "identity" && (
        <div className="mt-0.5 text-xl font-semibold text-zinc-900">
          Sample Applicant Name
        </div>
      )}
      {m.purpose === "subtitle" && (
        <div className="mt-0.5 text-sm text-zinc-600">
          Sample subtitle value
        </div>
      )}
      {m.purpose === "narrative" && (
        <div className="mt-1 space-y-1 text-sm text-zinc-700">
          <p>This is where the applicant&apos;s essay or narrative response will appear.</p>
          <p className="text-zinc-400">Lorem ipsum dolor sit amet, consectetur adipiscing elit. Reviewers will see the full text here in read-only format.</p>
        </div>
      )}
      {m.purpose === "metadata" && (
        <div className="mt-0.5 text-sm text-zinc-600">
          — sample value —
        </div>
      )}
      {m.purpose === "score" && (
        <select
          value={previewValues[m.fieldKey] ?? ""}
          onChange={(e) => setPreviewValues((prev) => ({ ...prev, [m.fieldKey]: e.target.value }))}
          className="mt-1 rounded border border-zinc-300 px-2 py-1 text-sm"
        >
          <option value="">— Select —</option>
          {options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      )}
      {m.purpose === "comments" && (
        <textarea
          placeholder="Reviewer comments will go here..."
          className="mt-1 w-full rounded border border-zinc-300 px-2 py-1 text-sm text-zinc-500"
          rows={2}
          readOnly
        />
      )}
      {m.purpose === "attachment" && (
        <div className="mt-1 flex items-center gap-1.5 text-sm text-zinc-500">
          <span>📎</span>
          <span>attachment-sample.pdf</span>
        </div>
      )}
    </div>
  );
}
```

This makes the preview functionally useful: an admin can see the difference between an identity field (large bold name), a narrative field (paragraph block), and a score field (dropdown).

---

## Issue 5 — Score dropdowns are empty in preview

### Root cause

`getOptionsForField` (line 157) looks up options from the `columns` prop:

```ts
function getOptionsForField(m: MappedField): string[] {
  const col = columns.find((c) => c.id === m.sourceColumnId);
  return col?.options ?? [];
}
```

The `columns` array is built in `route.ts` from `sheet_schema_snapshot_json`. The route maps `c.options` directly from the snapshot. This only works if:

1. The schema snapshot was taken after the PICKLIST column options were added in Smartsheet, AND
2. The Smartsheet API returned `options` as part of the column definition, AND
3. The snapshot captures them in the right shape (`string[]`)

If any of these failed when the snapshot was taken, `col.options` is `undefined` and the dropdown is empty. The snapshot is never refreshed automatically.

### Fixes

**Immediate (no schema change):** Add a fallback message in the score dropdown when options are empty, so the admin knows this is a data gap, not a bug:

```tsx
{m.purpose === "score" && (
  <div>
    <select ...>
      <option value="">— Select —</option>
      {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
    </select>
    {options.length === 0 && (
      <p className="mt-1 text-[11px] text-amber-600">
        No options found. Re-import the sheet schema if this column has PICKLIST options in Smartsheet.
      </p>
    )}
  </div>
)}
```

**Medium-term:** Add a "Refresh schema" button on the cycle config page that re-fetches the Smartsheet column definitions and updates `sheet_schema_snapshot_json`. This is already the right architecture (snapshot on demand) but needs to be more accessible. Score options will populate correctly once the snapshot includes them.

**Investigation step:** Before building either fix, check one existing cycle's `sheet_schema_snapshot_json` directly in the database to confirm whether PICKLIST `options` arrays are present. If they are in the snapshot but not appearing in the preview, the bug is in how `columns` is passed to `LayoutPreview`. If they are absent from the snapshot, the bug is in the schema import.

---

## Implemented: Color Controls

### What was built

A `ColorSwatch` inline component was added to `FieldMappingBuilder.tsx` and a colors section added to section 3 (Layout template).

**Four configurable colors, all defaulting to WSU brand values:**

| Control | Default | Purpose |
|---|---|---|
| Accent | `#A60F2D` (WSU Crimson) | Active tab underline, score field accent |
| Header background | `#ffffff` | Identity/header card background |
| Header text | `#171717` | Identity/header card text color |
| Card background | `#ffffff` | Content card background |

**`ColorSwatch` component** (inline, no external deps):
- Native `<input type="color">` for arbitrary color selection
- Hex text field for direct input with validation (`/^#[0-9a-fA-F]{0,6}$/`)
- "WSU ▾" palette button opens a 12-swatch dropdown with named WSU colors
- Click-outside closes via `useRef` + `mousedown` listener

**Persistence:**
- Colors are included in the POST body to `/api/admin/cycles/[id]/builder`
- Route stores them in `view_configs.settings_json` as `{ colors: { ... } }`
- Previously `settings_json` was hardcoded as `'{}'`; it now stores the colors object
- On load, `settings_json.colors` is merged with `DEFAULT_COLORS` so new fields added in future are always populated

**Preview integration:**
- `LayoutPreview` now accepts a `colors: LayoutColors` prop
- Tabbed layout: active tab uses `borderBottom: 2px solid colors.accent` and `backgroundColor: colors.cardBg`
- All layouts: card backgrounds and heading text use `colors.cardBg` / `colors.headerText` via inline styles
- Identity fields in preview use `colors.headerText` for the sample name

**"Reset to WSU defaults" button** clears all customizations back to WSU crimson defaults.

**Data model:** No schema migration needed. `view_configs.settings_json` is already a JSON column and was already being stored (as `{}`). The colors just populate it.

---

## Implemented: Purpose Framing (Issue 1)

The section 1 intro was rewritten to lead with what purpose actually does:

> Purpose controls how a field appears to reviewers. **Score** and **Comments** are the only editable purposes — reviewers fill them in and the values write back to Smartsheet. Everything else is read-only.

The "Purpose reference" panel header was replaced with an inline read-only vs editable colour key (`Blue = read-only · Amber = reviewer can edit`) so the admin can see the split at a glance without reading descriptions. The redundant footer note about type filtering was removed — the intro now covers it.

---

## Implemented: Undo Stack (Issue 2)

A lightweight undo stack was added entirely in client state — no API changes.

- `historyRef = useRef<MappedField[][]>([])` stores up to 20 snapshots
- `canUndo` state drives the Undo button's disabled state (avoids unnecessary re-renders from the ref itself)
- `pushHistory(mapped)` is called at the top of `addColumn`, `updateMapping`, and `removeMapping` before any state mutation
- `undo()` pops the last snapshot and calls `setMapped(prev)`
- An **Undo** button appears in the save toolbar, disabled when history is empty

Tab and section mutations (`addSection`, `updateSection`, `removeSection`) are not tracked — they are less likely to be accidentally changed and tracking everything would add noise.

---

## Implemented: Pinned Header Card + Colors — Reviewer & Preview Forms

This closes the gap between the builder (which saved `pinnedFieldKeys` and `colors` to the DB) and the actual reviewer and admin-preview UIs (which previously ignored both values).

### Config API changes

**`api/admin/cycles/[id]/preview-config/route.ts`** and **`api/reviewer/cycles/[cycleId]/config/route.ts`** — both updated identically:
- `SELECT view_type` → `SELECT view_type, settings_json`
- `settings_json` is parsed as `{ colors?: Record<string, string>; pinnedFieldKeys?: string[] }`
- Both `colors` (merged with `DEFAULT_COLORS`) and `pinnedFieldKeys` are now returned in the response JSON

### `ReviewerScoreForm.tsx`

- Added `LayoutColors` interface and `DEFAULT_COLORS` (matches builder defaults: accent `#A60F2D`, white bg/card, near-black header text)
- Added `colors: LayoutColors` and `pinnedFieldKeys: string[]` state
- `loadRow`: reads `configData.colors` (merged with defaults) and `configData.pinnedFieldKeys`; loads both into state
- `fields` is split into `pinnedFields` (keys in `pinnedFieldKeys`) and `unpinnedFields`; all existing section/editable/read-only arrays use `unpinnedFields`
- **Pinned header card** rendered above the tab/section block: flex row of label + value pairs using `colors.headerBg` and `colors.headerText` via inline style
- **Tabbed layout**: card wrapper uses `colors.cardBg`; active tab button drops hardcoded `border-zinc-900` in favour of `style={{ borderBottom: \`2px solid ${colors.accent}\` }}`

### `PreviewScoreForm.tsx`

Identical structure to `ReviewerScoreForm.tsx`:
- Same `LayoutColors` / `DEFAULT_COLORS` / `colors` / `pinnedFieldKeys` state
- `loadRow` reads and sets both values from `configData`
- Same `pinnedFields` / `unpinnedFields` split
- **Pinned header card** rendered above tab/section block using `colors.headerBg` / `colors.headerText`
- **Tabbed layout**: card wrapper uses `colors.cardBg`; active tab uses `style={{ borderBottom: \`2px solid ${colors.accent}\` }}`
- Amber "Preview mode — this is what reviewers see. No changes are saved." banner still shows at the very top so admins know their context

### Data model note

No schema migration was needed. `pinnedFieldKeys` and `colors` are both stored in the existing `view_configs.settings_json` JSONB column (written by the builder POST route). The `field_configs.pinned` migration listed in earlier versions of this document is **not required** — the key-list approach in `settings_json` is sufficient and avoids a schema change.

---

## Implemented: Pinned Header Card (Issue 3)

Fields can now be pinned to a persistent header card that appears above the tab bar (or above any layout). This is the "always-visible context" pattern — name, program, department, etc. remain visible regardless of which tab is active.

**`MappedField` interface:** `pinned?: boolean` added.

**Field table:** A new "Header" column was added to the grid (60px) in both tabbed and non-tabbed layouts. Each row has a **Pin** checkbox. When a field is pinned in tabbed mode, the Tab dropdown is replaced with a `—` placeholder (pinned fields don't belong to any tab).

**`LayoutPreview`:**
- `mapped` is split into `pinnedFields` and `unpinned` at the top of the component
- `fieldsBySection`, `readOnlyFields`, and `editableFields` all use `unpinned`
- A `PinnedCard` element is rendered above every layout type: a bordered card using `colors.headerBg` and `colors.headerText`, showing each pinned field as a label + sample value pair in a flex row

**Persistence — no DB migration needed.** `pinnedFieldKeys: string[]` is stored in `view_configs.settings_json` alongside `colors`. On load, `settings_json.pinnedFieldKeys` is read and used to mark matching `MappedField` entries as `pinned: true`. On save, pinned field keys are collected from `mapped` and included in the POST body. The route stores them in `settings_json`.

---

## Full Change Log

### `api/admin/cycles/[id]/preview-config/route.ts`

| Change | Detail |
|---|---|
| `SELECT view_type, settings_json` | Previously only selected `view_type` |
| Parse `settings_json` | Cast as `{ colors?; pinnedFieldKeys? }` |
| Return `colors` | Merged object from `settings_json.colors` |
| Return `pinnedFieldKeys` | Array from `settings_json.pinnedFieldKeys` |

### `api/reviewer/cycles/[cycleId]/config/route.ts`

| Change | Detail |
|---|---|
| `SELECT view_type, settings_json` | Previously only selected `view_type` |
| Parse `settings_json` | Cast as `{ colors?; pinnedFieldKeys? }` |
| Return `colors` | Merged object from `settings_json.colors` |
| Return `pinnedFieldKeys` | Array from `settings_json.pinnedFieldKeys` |

### `ReviewerScoreForm.tsx`

| Change | Detail |
|---|---|
| **v5: useSections** | Stacked/accordion use sections from config; no hardcoded labels |
| **v5: sections fallback** | `main` / "Review" when no viewSections |
| `LayoutColors` interface + `DEFAULT_COLORS` | Matches builder defaults (accent `#A60F2D`, white bg/card) |
| `colors` state | Loaded from config, merged with defaults |
| `pinnedFieldKeys` state | Loaded from config |
| `loadRow` | Sets `colors` and `pinnedFieldKeys` from `configData` |
| `pinnedFields` / `unpinnedFields` split | All layout queries use `unpinnedFields` |
| Pinned header card JSX | Above tab/section block; uses `colors.headerBg` / `colors.headerText` |
| Tabbed layout colors | Card wrapper `colors.cardBg`; active tab `borderBottom: 2px solid colors.accent` |

### `PreviewScoreForm.tsx`

| Change | Detail |
|---|---|
| **v5: useSections** | Stacked/accordion use sections from config; no hardcoded "Narrative & details" |
| **v5: sections fallback** | `main` / "Review" when no viewSections |
| `LayoutColors` interface + `DEFAULT_COLORS` | Same as `ReviewerScoreForm` |
| `colors` state | Loaded from preview-config, merged with defaults |
| `pinnedFieldKeys` state | Loaded from preview-config |
| `loadRow` | Sets `colors` and `pinnedFieldKeys` from `configData` |
| `pinnedFields` / `unpinnedFields` split | All layout queries use `unpinnedFields` |
| Pinned header card JSX | Above tab/section block; uses `colors.headerBg` / `colors.headerText` |
| Tabbed layout colors | Card wrapper `colors.cardBg`; active tab `borderBottom: 2px solid colors.accent` |

### `FieldMappingBuilder.tsx`

| Change | Detail |
|---|---|
| `useRef` added to imports | Required for `historyRef` and `ColorSwatch` click-outside |
| `WSU_COLORS` constant | 12-swatch WSU palette, mirrors newsletter editor in wsu-gradschool-tools |
| `LayoutColors` interface + `DEFAULT_COLORS` | accent `#A60F2D`, headerBg/headerText, cardBg |
| `MappedField.pinned?: boolean` | Marks field as pinned to header card |
| `data.viewConfigs` type updated | Exposes `settings_json.colors` and `settings_json.pinnedFieldKeys` |
| `useEffect` — load colors | Merges saved colors with defaults |
| `useEffect` — load pinnedFieldKeys | Marks `pinned: true` on matching fields when building `mapped` |
| Undo stack | `historyRef`, `canUndo`, `pushHistory`, `undo` |
| `addColumn` | Calls `pushHistory` before mutation |
| `updateMapping` | Calls `pushHistory` before mutation |
| `removeMapping` | Calls `pushHistory` before mutation |
| `handleSave` | Sends `colors` and `pinnedFieldKeys` in POST body |
| `LayoutPreview` — `colors` prop | Added in prior session |
| `LayoutPreview` — pinned split | `pinnedFields` / `unpinned`; all section/layout queries use `unpinned` |
| `LayoutPreview` — `PinnedCard` | Rendered above every layout; uses `colors.headerBg` / `colors.headerText` |
| `LayoutPreview` — `renderField` | Purpose-specific placeholders for all 7 purposes; score empty-state warning |
| `LayoutPreview` — tabbed colors | Active tab border uses `colors.accent`; card bg uses `colors.cardBg` |
| `LayoutPreview` — stacked colors | Card bg and heading text use color tokens |
| Section 1 intro | Rewritten to lead with the read-only vs editable framing |
| Purpose reference panel | Added read-only/editable colour key; removed redundant footer note |
| Grid columns | Added 60px "Header" column to both tabbed and non-tabbed templates |
| Field rows — pin cell | Checkbox + "Pin" label; tooltip explains header card |
| Field rows — tab suppression | Tab dropdown replaced with `—` when field is pinned |
| `ColorSwatch` component | Native color input + hex field + WSU palette dropdown with click-outside |
| Section 3 — Colors UI | Accent, header bg, header text, card bg; Reset to WSU defaults button |
| Toolbar — Undo button | Disabled when `canUndo` is false |
| **v5: Accordion cards** | All sections wrapped in `<AccordionCard>`; Map columns, Purpose & role visibility, Columns, Layout, Tabs, Preview |
| **v5: Purpose reference** | Restored with editable label, desc, editable toggle per purpose |
| **v5: purposeOverrides state** | Loaded from `settings_json.purposeOverrides`; saved in POST |
| **v5: isPurposeEditable** | Uses `purposeOverrides[p].editable` ?? (score \|\| comments) |
| **v5: Role visibility** | Moved into Purpose & role visibility card; filters by editable purposes |
| **v5: Locked column** | New column in table; lock icon when column locked |
| **v5: getPurposesForColumnType** | Fallback to TEXT_NUMBER when colType is "—" or missing |
| **v5: LayoutPreview stacked/accordion** | Uses `tabList`/sections; no hardcoded labels |
| **v5: Tabs card** | Shown for tabbed, stacked, accordion; renames to "Sections" |
| **v5: Purpose badge** | Removed from field rows |

### `route.ts`

| Change | Detail |
|---|---|
| `pinnedFieldKeys?: string[]` in body type | Added alongside existing `colors` |
| `pinnedFieldKeys` destructured from body | — |
| `settings_json` | Stores `{ colors, pinnedFieldKeys }` instead of hardcoded `'{}'` |
| `purposeOverrides` in body type | `Record<string, { label?, desc?, editable? }>` |
| `settings_json` (v5) | Now stores `{ colors, pinnedFieldKeys, purposeOverrides }` |
| Sections for stacked/accordion | Sections saved when viewType is tabbed, stacked, or accordion |
| Default `canEdit` | Uses `purposeOverrides[purpose].editable` when present |

---

## Implemented: Accordion Cards, Editable Purposes, Locked Column, Dynamic Sections (v5)

### Accordion card structure

All builder control areas are now collapsible accordion cards with bold titles (no numbers):

1. **Map columns** — Column picker only (click to add unmapped columns)
2. **Purpose & role visibility** — Editable purpose reference + role visibility table
3. **Columns** — Table of mapped fields (Column, Type, Locked, Purpose, Display label, Section, Pin, Remove)
4. **Layout** — Layout type (tabbed, stacked, accordion, list_detail) + colors
5. **Tabs** — Section configuration (shown for tabbed, stacked, accordion)
6. **Preview** — Layout preview

### Editable purpose reference

- Purpose reference panel restored with **editable** labels and descriptions per purpose
- Admin can customize label (e.g. "Identity" → "Applicant Name") and description
- **Editable toggle** per purpose — admin decides which purposes reviewers can edit (writes to Smartsheet)
- Default: Score and Comments are editable; others read-only
- Stored in `view_configs.settings_json.purposeOverrides` as `Record<string, { label?, desc?, editable? }>`
- Role visibility table shows only fields whose purpose is marked editable

### Purpose dropdown bug fix

- When column type is missing or `"—"`, `getPurposesForColumnType` now treats as `TEXT_NUMBER` so admins can switch between identity, metadata, etc.

### Locked column

- Added **Locked** column in the Columns table
- Shows lock icon (🔒) when Smartsheet column is locked; otherwise "—"

### Sections for all layout types (no hardcoding)

- Tabbed, stacked, and accordion use the **same** section configuration from the Tabs card
- Layout type only changes presentation: tabs vs stacked cards vs accordion panels
- Sections saved for tabbed, stacked, and accordion (not list_detail)
- **PreviewScoreForm** and **ReviewerScoreForm** use sections for stacked and accordion (no hardcoded "Narrative & details" / "Scores & comments")

### API changes

- Builder POST accepts `purposeOverrides` in body
- `settings_json` stores `{ colors, pinnedFieldKeys, purposeOverrides }`
- Sections saved when viewType is tabbed, stacked, or accordion
- Default `canEdit` for field permissions uses `purposeOverrides[purpose].editable` when present

### Purpose badge removed

- Colored purpose badge above the purpose dropdown in each field row was removed (per earlier request)

---

## Remaining / Future

- **Score options in preview**: empty-state warning is shown; root fix requires re-importing the sheet schema so PICKLIST options are captured in `sheet_schema_snapshot_json`. A "Refresh schema" action on the cycle config page is the right place.
- **Undo for tab/section changes**: not tracked; low priority since tab names are not easily mis-clicked.

---

## Original Proposals (superseded or carried forward)

Remove the "Purpose reference" legend. Replace with a two-sentence explainer above the field table:

> Purpose controls how a field appears in the reviewer form. **Score** and **Comments** are the only editable purposes — reviewers can fill them in and their values write back to Smartsheet. All other purposes are read-only.

Keep the color-coded `PURPOSE_STYLES` badges on each field row (blue = read-only, amber = editable) as the visual key. Remove the separate legend panel — the color on each row IS the legend.

### Proposal 2 — Undo stack (new)

See Issue 2 above. Implement `historyRef` + `pushHistory` + `undo()`. Add Undo button to the save toolbar, disabled when history is empty.

### Proposal 3 — Pinned header card (new, high priority)

See Issue 3 above. Add `pinned: boolean` to `MappedField` and `field_configs`. Render pinned fields in a persistent card above all layout types in both the preview and the reviewer UI. Replace Tab dropdown with "Header card / unpin" toggle for pinned rows.

Requires one migration: `ALTER TABLE field_configs ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT FALSE;`

### Proposal 4 — Preview content (replaces v1 no-op on this)

See Issue 4 above. Replace the empty `renderField` stubs with purpose-specific placeholder content. The preview must show *how data is presented*, not just *that a field exists*.

### Proposal 5 — Score options: empty state + schema refresh path

See Issue 5 above. Add inline warning when score options are empty. Surface a "refresh schema" action on the cycle config page.

### Proposal 6 — Column picker and field row polish (carries over from v1)

These remain valid and are lower priority than 1–5:

- Column picker buttons: show Smartsheet type badge and locked badge before the admin clicks
- Field rows: dedicated drag handle icon (⠿) as first column instead of whole-row drag
- Locked conflict warning: move to top-of-row banner, not bottom
- Tab management UI: move to its own subsection below the field table

---

## Data Model Changes Required

| Change | Required for | Migration | Status |
|---|---|---|---|
| `field_configs.pinned BOOLEAN DEFAULT FALSE` | ~~Pinned header card~~ | ~~`ALTER TABLE field_configs ADD COLUMN...`~~ | **Not needed** — `pinnedFieldKeys` stored in `view_configs.settings_json` |
| Schema refresh endpoint or action | Score options fix (medium-term) | No schema change; new API route or existing cycle config action | Pending |

No schema migrations were needed for any implemented features. All configuration is stored in existing JSONB columns (`view_configs.settings_json`).

---

## Implementation Priority

1. **Pinned header card** — blocks usable tab layout for any multi-tab application
2. **Preview content rendering** — without this the preview is misleading
3. **Score options: empty state** — quick win, unblocks understanding of whether data is present
4. **Undo stack** — blocks confident editing
5. **Purpose framing** — copy/UX change, no code logic
6. **Polish: column picker, drag handle, locked warning** — can follow
