# Field Mapping Builder — UI Review & Improvement Proposals

**File reviewed:** `src/app/admin/scholarships/[id]/cycles/[cycleId]/builder/FieldMappingBuilder.tsx`
**Related files:** `builder/page.tsx`, `api/admin/cycles/[id]/builder/route.ts`

---

## Current Issues

### 1. Purpose Definitions (lines 513–521)

**Discovery problem.** The section uses `text-xs text-zinc-500` inside a `<details>` element that is collapsed by default. It is low-contrast, easy to miss, and most admins will never open it.

**Content problem.** The list describes what each purpose means, but does not show which Smartsheet column types are allowed for each one. This is the wrong direction for the admin's mental model. An admin thinks: "I have a PICKLIST column — what purposes can I assign?" not "I want to set Score — what columns can I use?"

**Context gap.** The note explaining that purpose options are filtered by column type appears only inside the collapsed footer. Admins who do not read it will not understand why a purpose is missing from a dropdown.

---

### 2. Column Picker (lines 497–511)

Plain flat buttons with no type context. An admin looking at `+ Program GPA` has no way to know whether it is a PICKLIST, TEXT_NUMBER, or something else before clicking, and therefore no way to anticipate which purposes will be available. Locked columns are not visually flagged until after they are added.

---

### 3. Field Rows (lines 573–677)

- The "Type" badge shows raw Smartsheet API strings (`TEXT_NUMBER`, `ABSTRACT_DATETIME`). These are accurate but not admin-friendly as the primary label.
- The purpose `<select>` uses a `title` attribute for the description tooltip. Tooltips are slow on desktop and invisible on touch — not a reliable mechanism for communicating purpose descriptions.
- No visual distinction between read-only purposes (identity, subtitle, narrative, metadata) and editable ones (score, comments). Both look identical in the row.
- The locked column conflict warning is rendered at the bottom of the row via `col-span-full`. It is easy to miss on first scan because it appears after all the controls.
- The drag affordance is the entire row, but there is no visible handle. The cursor changes on hover, but that is invisible until the user mouses over the row.

---

### 4. Tab Management (lines 525–561)

Tab management lives inside section 1, between the column picker and the field table. This makes section 1 responsible for three separate tasks: adding columns, naming tabs, and configuring each field. The cognitive load is high and the visual hierarchy is unclear.

---

### 5. Extensibility Gaps

- `SMARTSHEET_TYPE_TO_PURPOSES` is the correct single source of truth for type-to-purpose filtering, but has no inline documentation explaining *why* a type maps to certain purposes. Future maintainers must infer the reasoning.
- `DISPLAY_TYPES` (the implicit purpose → displayType map) is used in both the component and the POST handler, but there is no comment connecting them. Adding a new purpose requires updating both places and the `validDisplayTypes` array in the route — this is not obvious.
- `getPurposesForColumnType` falls back to all purposes for unknown column types (line 41). This could surface confusing options for unusual API types. A narrower fallback (e.g. `["metadata"]`) would be safer.

---

## Proposed Improvements

### Proposal 1 — Replace the Purpose Definitions collapsible with an inline reference panel

Remove the `<details>` element. Replace it with a compact always-visible legend directly above the field table. Use color-coded badges that match the purpose badges in each field row, so the legend and the table are visually consistent.

Add a `PURPOSE_STYLES` constant near `PURPOSES`:

```ts
const PURPOSE_STYLES: Record<string, string> = {
  identity:   "bg-blue-100 text-blue-700",
  subtitle:   "bg-blue-50 text-blue-600",
  narrative:  "bg-violet-100 text-violet-700",
  score:      "bg-amber-100 text-amber-700",
  comments:   "bg-amber-50 text-amber-700",
  metadata:   "bg-zinc-200 text-zinc-600",
  attachment: "bg-teal-100 text-teal-700",
};
```

Replace lines 513–524 with:

```tsx
<div className="mb-4 rounded-lg border border-zinc-100 bg-zinc-50 p-3">
  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
    Purpose reference
  </div>
  <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-4">
    {PURPOSES.map((p) => (
      <div key={p.value} className="flex items-start gap-1.5">
        <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${PURPOSE_STYLES[p.value]}`}>
          {p.label}
        </span>
        <span className="text-xs text-zinc-500">{p.desc}</span>
      </div>
    ))}
  </div>
  <p className="mt-2 text-[11px] text-zinc-400">
    Available purposes are filtered by each column&apos;s Smartsheet type.
    Hover any purpose dropdown to see why options may be limited.
  </p>
</div>
```

Use `PURPOSE_STYLES` on the purpose badge in each field row (see Proposal 3) to create a consistent visual link between the legend and the table.

---

### Proposal 2 — Column picker: add type and locked badges to each button

Replace the flat button list (lines 497–511) with buttons that show the column type and locked state before the admin clicks:

```tsx
<div className="mb-4">
  <div className="mb-1 text-xs text-zinc-500">
    Click a column to add it. Unmapped columns are shown below.
  </div>
  <div className="flex flex-wrap gap-2">
    {unmappedColumns.map((col) => (
      <button
        key={col.id}
        type="button"
        onClick={() => addColumn(col)}
        className="flex items-center gap-1.5 rounded border border-zinc-300 px-2.5 py-1.5 text-sm hover:bg-zinc-50 hover:border-zinc-400"
      >
        <span>+ {col.title}</span>
        <span className="rounded bg-zinc-100 px-1 py-0.5 text-[10px] font-mono text-zinc-500">
          {col.type}
        </span>
        {col.locked && (
          <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-700">
            locked
          </span>
        )}
      </button>
    ))}
    {unmappedColumns.length === 0 && columns.length > 0 && (
      <span className="text-sm text-zinc-500">All columns mapped</span>
    )}
  </div>
</div>
```

This gives the admin two pieces of information before clicking: the column type (so they can anticipate which purposes will be available) and whether the column is locked (so they know to avoid Score/Comments before adding it).

---

### Proposal 3 — Field rows: drag handle icon, purpose badge, and top-of-row locked warning

**a) Drag handle.** Add a dedicated handle column as the first cell in each row. Move `draggable`/`onDragStart`/`onDrop` to the handle element rather than the full row div. This prevents dropdown interactions from accidentally initiating a drag.

Add to the grid header as the first `<span>`:
```tsx
<span className="w-5" /> {/* drag handle */}
```

Add as the first cell in each row:
```tsx
<div
  draggable
  onDragStart={...}
  onDragOver={...}
  onDrop={...}
  className="flex w-5 shrink-0 cursor-grab items-center justify-center text-zinc-300 hover:text-zinc-500 active:cursor-grabbing"
  title="Drag to reorder"
>
  ⠿
</div>
```

**b) Purpose badge above the select.** Wrap the existing `<select>` in a small container that shows the current purpose as a colored badge:

```tsx
<div className="flex flex-col gap-1">
  <span className={`self-start rounded px-1.5 py-0.5 text-[10px] font-medium ${PURPOSE_STYLES[m.purpose] ?? "bg-zinc-100 text-zinc-500"}`}>
    {PURPOSES.find((p) => p.value === m.purpose)?.label ?? m.purpose}
  </span>
  <select
    value={m.purpose}
    onChange={(e) =>
      updateMapping(idx, {
        purpose: e.target.value,
        displayType: DISPLAY_TYPES[e.target.value] || m.displayType,
      })
    }
    className="rounded border border-zinc-300 px-2 py-1.5 text-sm"
    title={PURPOSES.find((p) => p.value === m.purpose)?.desc}
  >
    {/* options unchanged */}
  </select>
</div>
```

**c) Locked warning as a top-of-row banner.** Move the `lockedConflict` block from the bottom of the row to the top, so it appears as a banner before the field controls:

```tsx
{lockedConflict && (
  <div className="col-span-full mb-1 flex items-center gap-1.5 rounded bg-amber-100 px-2 py-1 text-xs text-amber-800">
    <span>⚠</span>
    <span>
      Locked column — write conflicts will occur if used as Score or Comments.
      Change purpose or unlock in Smartsheet.
    </span>
  </div>
)}
```

Place this before the column/type/purpose/label cells in the grid, not after.

---

### Proposal 4 — Move tab management to its own numbered subsection

Remove the tab management UI from inside section 1 (lines 525–561). Place it as a separate section after the field table, only rendered when `viewType === "tabbed"`. This reduces section 1 to a single responsibility: adding and configuring fields.

```tsx
{viewType === "tabbed" && (
  <section className="rounded-lg border border-zinc-200 bg-white p-4">
    <h2 className="mb-1 font-medium text-zinc-900">1b. Tabs</h2>
    <p className="mb-3 text-sm text-zinc-600">
      Create tabs and assign fields using the Tab column in the field table above.
    </p>
    <div className="mb-2 flex items-center justify-between">
      <span className="text-sm font-medium text-zinc-700">Tabs</span>
      <button
        type="button"
        onClick={addSection}
        className="rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100"
      >
        + Add tab
      </button>
    </div>
    <div className="flex flex-wrap gap-2">
      {sections.map((s, i) => (
        <div key={s.section_key} className="flex items-center gap-1 rounded border border-zinc-200 bg-white px-2 py-1">
          <input
            type="text"
            value={s.label}
            onChange={(e) => updateSection(i, { label: e.target.value })}
            className="w-32 rounded border-0 bg-transparent px-1 py-0.5 text-sm focus:ring-1 focus:ring-zinc-400"
            placeholder="Tab label"
          />
          {sections.length > 1 && (
            <button
              type="button"
              onClick={() => removeSection(i)}
              className="text-xs text-red-600 hover:text-red-700"
              title="Remove tab"
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  </section>
)}
```

The Tab column in the field table still appears when `viewType === "tabbed"`, so the assignment workflow is unchanged — just the creation/naming UI moves to its own section.

---

### Proposal 5 — Extensibility: document the implicit contracts

**`SMARTSHEET_TYPE_TO_PURPOSES`** — add an optional `note` per entry to document the reasoning:

```ts
const SMARTSHEET_TYPE_TO_PURPOSES: Record<string, { purposes: string[]; note?: string }> = {
  PICKLIST: {
    purposes: ["identity", "subtitle", "score", "metadata"],
    note: "Fixed-option columns map well to score fields",
  },
  TEXT_NUMBER: {
    purposes: ["identity", "subtitle", "narrative", "score", "comments", "metadata"],
  },
  // ...
};
```

Update `getPurposesForColumnType` to read `entry.purposes` instead of the array directly.

**`DISPLAY_TYPES`** — add a comment making the contract explicit:

```ts
/**
 * Maps purpose → display_type used in the reviewer UI.
 * When adding a new purpose:
 *   1. Add an entry here.
 *   2. Add the display_type value to validDisplayTypes in route.ts.
 *   3. Add a renderer for the display_type in the reviewer view component.
 */
const DISPLAY_TYPES: Record<string, string> = { ... };
```

**`getPurposesForColumnType` fallback** — narrow from "all purposes" to `["metadata"]` for unknown types:

```ts
function getPurposesForColumnType(colType: string): Array<(typeof PURPOSES)[number]> {
  const allowed = SMARTSHEET_TYPE_TO_PURPOSES[colType]?.purposes;
  if (!allowed?.length) {
    // Unknown type: restrict to metadata only rather than showing all options.
    return PURPOSES.filter((p) => p.value === "metadata");
  }
  return PURPOSES.filter((p) => allowed.includes(p.value));
}
```

---

## Change Summary

| Location | Change | Reason |
|---|---|---|
| Lines 513–524 | Replace `<details>` with always-visible legend using `PURPOSE_STYLES` | Discovery + visual consistency |
| Near `PURPOSES` | Add `PURPOSE_STYLES` record | Consistent color coding throughout |
| Lines 497–511 | Column picker buttons show type badge + locked badge | Context before clicking |
| Field row header | Add drag handle column | Clear affordance |
| Field row cells | Move drag handlers to handle cell; add purpose badge above select | Prevents accidental drag; visual identity |
| `lockedConflict` block | Move to top of row as banner | Visibility |
| Lines 525–561 | Move tab management to separate numbered subsection | Reduce cognitive load in section 1 |
| `SMARTSHEET_TYPE_TO_PURPOSES` | Add optional `note` per entry | Self-documenting for future extensions |
| `DISPLAY_TYPES` | Add comment documenting the three-step contract | Prevent missed updates when adding purposes |
| `getPurposesForColumnType` | Narrow unknown-type fallback to `["metadata"]` | Avoid confusing options for unusual API types |

All changes are confined to `FieldMappingBuilder.tsx`. No API, database, or data model changes are required.
