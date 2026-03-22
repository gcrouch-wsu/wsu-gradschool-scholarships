# Unified Layout Builder Technical Execution Blueprint

Implementation blueprint for replacing the current unstable desktop layout behavior in both:

- the intake form builder
- the reviewer layout builder

This document is the pre-coding technical contract. It builds on `layout-builder-spec.md` and converts the high-level direction into exact persistence, validation, interaction, migration, and rollout rules.

It does not change Smartsheet ownership rules. Smartsheet remains the source of truth for structured nominee data.

---

## 1. Executive Verdict

The shared row-based layout direction is correct and should be used for both builders.

The key change from the short spec is that this blueprint locks the rules that were previously too loose to code against:

- exact `layout_json` ownership and shape
- exact save vs publish behavior
- exact drag/drop collision behavior
- exact legacy migration behavior
- exact keyboard and runtime fallback behavior

Implementation should proceed in two phases:

1. intake builder and public intake renderer
2. reviewer builder and reviewer/admin renderers

Do not refactor both builders in one batch.

---

## 2. Final Architecture Decisions

These decisions are locked for the refactor.

| Area | Decision |
|---|---|
| Shared model | Both builders use the same saved layout schema |
| Layout structure | `sections -> rows -> items` |
| Desktop widths | Only `full` and `half` |
| Valid row shapes | exactly one `full` item, or exactly two `half` items |
| Desktop columns | Maximum two |
| Mobile rendering | All items stack vertically in row order |
| Runtime rendering | Renders from saved `layout_json`, not inferred field flags |
| Intake persistence | `intake_forms.layout_json`, copied into `intake_form_versions.snapshot_json.layout_json` |
| Reviewer persistence | `view_configs.layout_json`, copied into `config_versions.snapshot_json.layout_json` |
| Pinned reviewer fields | Stay outside the row canvas and outside section rows |
| Unplaced fields | Represented in the builder field library, not in `layout_json` |
| Draft save | Allowed with unplaced fields |
| Publish | Blocked until all required placement rules are satisfied |
| DnD library | Use `@dnd-kit` for both builders |
| Legacy intake `layout_mode` | Treated as legacy-only and normalized into safe full-width rows |
| Legacy reviewer section ordering | Preserved by section, but each field becomes a full-width row on migration |
| Section ordering | Array order is canonical; `sort_order` is rewritten to match array index on save |

---

## 3. Persistence Model

### 3.1 Ownership

Layout must be stored separately from per-field metadata.

Use these exact storage targets:

- intake draft state: `intake_forms.layout_json`
- intake published snapshots: `intake_form_versions.snapshot_json.layout_json`
- reviewer draft state: `view_configs.layout_json`
- reviewer saved snapshots: `config_versions.snapshot_json.layout_json`

The schema change for these columns should live in `supabase/migrations/007_layout_json.sql`.

The layout is app-owned UI metadata. It must not be stored in Smartsheet and must not be buried inside per-field `settings_json`.

### 3.2 Persisted layout contract

The persisted shape is:

```ts
type LayoutWidth = "full" | "half";

interface SavedLayoutItem {
  item_key: string;
  field_key: string;
  width: LayoutWidth;
}

interface SavedLayoutRow {
  row_key: string;
  items: SavedLayoutItem[];
}

interface SavedLayoutSection {
  section_key: string;
  label: string;
  sort_order: number;
  rows: SavedLayoutRow[];
}

interface SavedLayoutJson {
  version: 1;
  sections: SavedLayoutSection[];
  pinned_field_keys?: string[];
}
```

Rules:

- `version` is required
- `sections` is required, even if there is only one section
- `pinned_field_keys` is used only by reviewer layouts
- `item_key` and `row_key` are app-generated stable identifiers for drag state and deterministic saves
- `item_key` and `row_key` are generated with UUIDs when rows/items are first created or migrated
- `item_key` and `row_key` are preserved across drag, save, publish, clone, and reload
- `item_key` and `row_key` are regenerated only when a brand-new item or row is created
- `field_key` continues to be the canonical link to field metadata
- section array order is canonical; `sort_order` is a persisted mirror of array index for export and debugging only

### 3.3 Persisted field metadata vs persisted layout metadata

Persisted field metadata continues to own:

- label
- purpose
- display type
- help text
- required flag
- target Smartsheet column mapping
- blind-review hiding flag
- reviewer editability
- other field-specific behavior

Persisted layout metadata owns only:

- section membership
- row order
- item order inside a row
- item width
- pinned reviewer field list

This separation is mandatory. A field must remain valid even if it is temporarily unplaced.

### 3.4 Transient builder UI state

The builder may hold additional unsaved local state that is never persisted directly:

- selected field
- hovered drop target
- dragged item metadata
- unsaved section rename draft
- dirty state
- undo history

Transient UI state must not leak into `layout_json`.

---

## 4. Field Library Contract

### 4.1 Purpose

The builder must have an explicit field library panel showing fields that exist in metadata but are not currently placed in the layout.

This solves the current ambiguity around "missing" fields and keeps placement separate from definition.

### 4.2 How fields appear in the library

A field is "unplaced" when:

- it exists in the owning metadata table
- it is not pinned
- its `field_key` does not appear anywhere in `layout_json.sections[].rows[].items[]`

Pinned reviewer fields do not appear in the main unplaced library. They appear in the pinned-field area only.

### 4.3 Save rules

Draft save is allowed when fields remain unplaced.

Reason:

- admins need to save incremental builder work
- layout editing and field definition are separate concerns

### 4.4 Publish rules

Publish is blocked when placement is incomplete.

For intake:

- every field must be placed exactly once
- every draft field row is publish-eligible unless it has been removed from draft entirely
- there is no disabled or hidden intake field class in this refactor

For reviewer:

- every non-pinned field must be placed exactly once
- every pinned field must appear exactly once in `pinned_field_keys`

Publish must fail with a clear admin-facing error listing the unplaced field labels.

---

## 5. Validation Contract

Server-side validation is required on every save and publish.

### 5.1 Save validation

Save must validate:

- `layout_json.version === 1`
- every `section_key` is unique
- every `row_key` is unique within the layout
- every `item_key` is unique within the layout
- every referenced `field_key` exists
- no field appears more than once across all rows
- no pinned reviewer field appears inside section rows
- no non-pinned reviewer field appears in `pinned_field_keys`
- every row is one of the allowed shapes

Draft save may succeed even if some eligible fields are unplaced.

### 5.2 Publish validation

Publish must validate everything from save validation plus:

- all required sections exist
- every publish-eligible field is placed exactly once
- intake layouts contain no pinned fields
- reviewer layouts contain all pinned fields exactly once
- no section is empty if the chosen reviewer view mode requires visible section content

### 5.3 Valid row shapes

Only these row shapes are valid in persisted layout:

- `[full]`
- `[half, half]`

All other shapes are invalid:

- `[half]`
- `[full, half]`
- `[half, full]`
- `[half, half, half]`
- `[]`

The persisted layout model never stores incomplete half rows.

---

## 6. Canvas Interaction Model

### 6.1 Core builder structure

Both builders use the same three-pane interaction model:

- left: field library
- center: section-based layout canvas
- right: properties for the selected field or row

Reviewer keeps its reviewer-specific controls in the right pane.
Intake keeps intake-specific controls in the right pane.

### 6.2 Section canvas behavior

Each section canvas contains ordered rows.
Each row exposes precise drop targets:

- above row
- below row
- left side of row
- right side of row
- field body for reorder-within-row

There are no free-floating left and right lane buckets.

### 6.3 Deterministic drop rules

These rules are locked.

#### Drag into an empty section

Result:

- create a new row with one `full` item

#### Drag above or below an existing row

Result:

- insert a new row at that position
- the inserted row contains one `full` item

#### Drag onto the left or right side of a row that currently contains one `full` item

Result:

- convert the existing row into a two-item row
- both items become `half`
- the dropped side determines left/right placement
- the existing field occupies the remaining side

This is the only automatic row reshaping allowed.

#### Drag onto the left or right side of a row that already contains two `half` items

Result:

- reject the drop
- show a visual "not allowed" state

Do not silently push an existing item into a new row.

#### Drag one item out of a two-half row

Result:

- remove the dragged item from the source row
- the remaining item auto-converts to a single `full` row

#### Reorder within a two-half row

Result:

- swap left/right order only

#### Drag from one section into another section

Result:

- the explicit drop target wins
- dropping above or below a row in the target section inserts a new full-width row at that position
- dropping into an empty target section creates a new full-width row at the end of that section
- keyboard `Move to section above` / `Move to section below` appends the field as the last full-width row in the destination section
- do not auto-pair cross-section moves into existing half rows unless the user targets a valid left/right drop zone directly

### 6.4 Invalid drop philosophy

Invalid drops must be rejected, not "fixed" by surprising reshuffles.

Allowed automatic adjustments are limited to:

- full row -> two half row when dropping beside a single full item
- two half row -> one full row when one item is removed

Everything else must be explicit.

### 6.5 Width controls

Users do not manage width through free-form percentages.

Width comes from row composition:

- one-item row => `full`
- two-item row => both items `half`

The UI may expose row actions such as:

- "Make full row"
- "Place beside another field"

But the persisted state must always match one of the valid row shapes.

---

## 7. State Management Strategy

### 7.1 Recommended drag system

Use `@dnd-kit` with sortable primitives.

Reason:

- deterministic collision handling
- accessible keyboard support
- precise control over nested sortable containers
- more predictable than ad hoc HTML5 drag-and-drop for rows and items

### 7.2 Client state shape

The builder should maintain three distinct state layers:

1. `savedServerState`
   - last fetched field metadata
   - last fetched `layout_json`

2. `draftBuilderState`
   - editable fields
   - editable layout
   - selected item
   - pending section changes

3. `interactionState`
   - active drag item
   - hovered drop target
   - drag preview information

These layers must not be conflated.

### 7.3 Shared implementation shape

Use one shared layout engine made of:

- shared layout types and validators
- shared row/item drag primitives
- shared keyboard move helpers

Wrap that engine in two builder-specific shells:

- intake builder shell
- reviewer builder shell

Do not force both products into one giant monolithic builder component.

### 7.4 Dirty-state rules

Dirty state becomes true when:

- field metadata changes
- row placement changes
- section order changes
- pinned reviewer field placement changes

Dirty state must compare against the last successful server save, not against initial page load only.

### 7.5 Undo expectations

Undo is optional but recommended for the builder only.

If present:

- it applies to local draft state only
- it does not require server round trips
- it does not bypass validation on save

---

## 8. UX And Accessibility Requirements

### 8.1 Visual hierarchy

Runtime renderers must keep labels above inputs.

Do not use side-by-side label placement for intake or reviewer field rendering.
The two-column layout affects field blocks, not label placement.

### 8.2 Keyboard alternatives to drag-and-drop

Both builders must provide non-drag controls for users who do not use a mouse.

Required actions:

- Move row up
- Move row down
- Move item left
- Move item right
- Move item to section above
- Move item to section below
- Send item back to field library
- Pin field / unpin field for reviewer

These controls may appear in an overflow menu or property panel, but they must exist.

### 8.3 Focus behavior

After any keyboard or button move:

- keep focus on the moved field card or its primary control
- if the moved item leaves the current section, focus follows it
- if the item is returned to the field library, focus lands on the field-library entry

### 8.4 Screen-reader labeling

Movement controls must expose explicit labels such as:

- `Move Student Name row up`
- `Move GPA field to right column`
- `Return Transcript Upload to unplaced fields`

Do not rely on icon-only buttons without accessible text.

---

## 9. Mobile And Runtime Rendering Rules

### 9.1 Mobile rendering

Mobile ignores desktop widths and renders:

- section order
- row order
- item order within each row

A desktop two-half row becomes two stacked field blocks on mobile in left-to-right order.

### 9.2 Runtime fallback rules

Runtime renderers must be defensive.

If stale or bad layout data is encountered:

- unknown `version`: treat persisted layout as unreadable and fall back to normalized legacy layout if available
- missing field in layout: skip the item and log a client-safe warning if appropriate
- row with one `half`: render the item as `full`
- row with invalid combination: render each valid referenced field as its own full-width block in row order
- missing section label: fall back to the `section_key`

The runtime renderer must not crash because of malformed layout data.

### 9.3 Publish-time guarantee

Published runtime paths should not normally see malformed layout because publish validation blocks it.

The defensive renderer exists as a safety net, not as a substitute for save/publish validation.

---

## 10. Reviewer-Specific Rules

### 10.1 Pinned field model

Pinned reviewer fields remain separate from section rows.

They render in the pinned header area and are not part of the main section canvas.

Pinned fields:

- are stored in `pinned_field_keys`
- do not appear in section rows
- do not use row width settings

### 10.2 Blind review behavior

Blind-review hiding remains field metadata, not layout metadata.

That means:

- a hidden-in-blind-review field still must be placed
- the reviewer runtime filters it out when blind review is enabled
- the layout builder still shows it so admins understand placement

### 10.3 Reviewer view modes

Reviewer view modes remain:

- `tabbed`
- `stacked`
- `accordion`
- `list_detail`

These are render modes over the same saved section/row structure.
They are not separate layout systems.

---

## 11. Migration And Normalization Plan

### 11.1 Intake migration

Current intake layout is based on per-field `settings_json.layout_mode` values such as:

- `full`
- `left`
- `right`

That model does not reliably describe row grouping, so migration must be conservative.

Migration rule:

- each existing intake field becomes its own `full` row
- existing field order becomes row order
- legacy `layout_mode` is ignored for persisted layout generation

This is intentional. Do not try to guess left/right pairings from legacy data.

### 11.2 Reviewer migration

Current reviewer layout already has:

- sections
- pinned-field list
- ordered section membership

Migration rule:

- preserve section order and labels
- preserve pinned reviewer fields
- each non-pinned field becomes its own `full` row within its current section
- current section-field ordering becomes row order

### 11.3 Read-time normalization

During rollout:

- loaders may read legacy intake/reviewer layout state
- loaders normalize it into the new `layout_json` shape in memory
- editors present the normalized layout immediately

### 11.4 Save-time rewrite

On first successful save in the new builder:

- persist canonical `layout_json`
- stop relying on legacy intake `layout_mode`
- stop relying on reviewer `section_fields` for placement

Legacy sources become migration inputs only.

### 11.5 Legacy publish behavior

If a cycle was last saved under the legacy layout model and has no persisted `layout_json` yet:

- the loader must normalize legacy state in memory
- publish may proceed using that normalized layout
- the publish path must write canonical `layout_json` into the new owner column and snapshot

Admins do not need to manually open and resave a legacy cycle before publish.

---

## 12. Implementation Order

Implementation must happen in this order.

### Phase 1: shared schema and validation

- add `layout_json` to intake and reviewer owner records
- add shared normalization helpers
- add shared layout validation helpers
- add publish validation rules

### Phase 2: intake runtime and builder

- intake loader reads normalized `layout_json`
- public intake renderer uses section/row/item rendering
- intake builder uses field library + row canvas + property panel
- intake publish path blocks unplaced fields

### Phase 3: reviewer runtime

- reviewer config loader reads normalized `layout_json`
- reviewer runtime and admin preview render from section/row/item layout
- pinned-field rendering stays separate

### Phase 4: reviewer builder

- reviewer builder uses shared row canvas
- section assignment becomes section placement within layout
- pinned-field controls stay outside the main canvas

### Phase 5: cleanup

- remove intake reliance on `settings_json.layout_mode`
- deprecate reviewer placement reliance on legacy section-field ordering
- update export/import and clone-config flows to include `layout_json`

---

## 13. Test Checkpoints

### 13.1 Shared validation tests

Required:

- valid `[full]` row passes
- valid `[half, half]` row passes
- duplicate field placement fails
- pinned field inside section rows fails
- unplaced field blocks publish

### 13.2 Intake tests

Required:

- legacy intake fields normalize to one full row each
- saved layout renders identically after reload
- public intake mobile render stacks paired rows correctly
- invalid draft layout never reaches published runtime

### 13.3 Reviewer tests

Required:

- legacy reviewer section layout normalizes correctly
- pinned fields stay outside section rows
- blind-review hidden fields are filtered at runtime but still placed in config
- all view modes render from the same saved row structure

### 13.4 Version fallback tests

Required:

- unknown `layout_json.version` is rejected by save/publish validation
- runtime read helpers fall back to normalized legacy layout when `layout_json` is missing

---

## 14. Gemini Review Guidance

If this document is reviewed externally, the reviewer should assess:

- whether the `layout_json` contract is specific enough to build
- whether the drag/drop collision rules are deterministic
- whether the migration plan is conservative enough
- whether the shared core plus builder-specific property panels is the right architecture
- whether the intake-first, reviewer-second rollout is the safest order

The reviewer should not assume the current lane-based intake model or the current reviewer section list should survive unchanged.

---

## 15. Definition Of Ready

Coding should start only once the team accepts these locked decisions:

- one shared saved layout schema for both builders
- section/row/item persistence
- two-column maximum
- conservative legacy migration
- unplaced fields allowed in draft but blocked at publish
- `@dnd-kit` as the drag system
- intake first, reviewer second

Once those are accepted, this blueprint is sufficient for implementation planning and task breakdown.
