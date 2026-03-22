# Unified Layout Builder Short Spec

Focused design spec for replacing the current ad hoc layout controls in both:

- intake form builder
- reviewer layout builder

This is a UI and saved-layout spec only. It does not change Smartsheet ownership rules.

For the implementation-ready contract, use `layout-builder-blueprint.md`.

---

## 1. Goal

Replace the current weak desktop layout model (`full | left | right` flags and separate per-builder drag behavior) with one shared row-based layout system that is:

- predictable to drag
- stable to save and reload
- consistent between builder preview and runtime rendering
- usable for both intake forms and reviewer pages

---

## 2. Problems With The Current Model

### Intake builder

Current intake layout is stored as a per-field desktop flag in `settings_json.layout_mode`.

That is not enough information to describe:

- row grouping
- left/right pairing
- stable vertical order inside a two-column layout
- what should happen when one field is moved beside another

Result: the layout feels shaky because lane assignment is being used as a substitute for an actual layout model.

### Reviewer builder

Reviewer layout already has stronger structure through sections, but field placement is still mostly a vertical list plus section assignment. If two-column layout is added using the same lane approach, it will have the same instability as intake.

---

## 3. Final Direction

Use one shared saved layout model for both builders:

- `layout_json`
- `sections -> rows -> items`

Each section contains ordered rows.
Each row contains ordered items.
Each item points at exactly one field.

Desktop width is controlled at the row item level, not the field level.

---

## 4. Layout Rules

### 4.1 Supported widths

Only support these widths:

- `full`
- `half`

Do not support arbitrary percentages.
Do not support 3+ desktop columns in v1 of this refactor.

### 4.2 Row rules

Each row can contain:

- one `full` item, or
- two `half` items

Invalid rows are not saved.

Examples:

- `[full]`
- `[half, half]`

Invalid:

- `[full, half]`
- `[half, half, half]`

### 4.3 Mobile behavior

Mobile ignores desktop width and stacks items vertically in row order.

### 4.4 Section behavior

Both builders continue to use sections.

For intake:

- default single section is acceptable
- multiple sections may be added later, but the layout model should support them now

For reviewer:

- keep existing section support
- tabbed, stacked, and accordion views continue to read from sections

---

## 5. Saved Data Shape

Store layout separately from field metadata.
Do not bury layout in individual field `settings_json`.

Proposed shape:

```json
{
  "version": 1,
  "sections": [
    {
      "section_key": "main",
      "rows": [
        {
          "row_key": "row_1",
          "items": [
            { "field_key": "student_name", "width": "half" },
            { "field_key": "student_id", "width": "half" }
          ]
        },
        {
          "row_key": "row_2",
          "items": [
            { "field_key": "narrative", "width": "full" }
          ]
        }
      ]
    }
  ]
}
```

### 5.1 Ownership

- intake builder owns its own `layout_json`
- reviewer builder owns its own `layout_json`

Do not try to share the same persisted layout record between intake and reviewer.
Share the schema and UI behavior, not the actual DB row.

---

## 6. Builder UX

Both builders should use the same interaction model.

### 6.1 Main structure

Three-pane desktop builder:

- left: available fields
- center: layout canvas
- right: selected field properties

Mobile can collapse this into stacked panels.

### 6.2 Canvas behavior

The canvas is section-based.
Within a section, users drag fields into rows.

Allowed actions:

- drag field into empty row slot
- drag field below another row to create a new row
- drag a field beside a compatible half-width field
- drag a field out of a row back into the field list
- reorder rows vertically

### 6.3 Width behavior

Users should not drag into free-floating left/right buckets.
Instead:

- dropping into a row slot decides placement
- width is shown explicitly on the item
- item width can be toggled between `full` and `half`
- if changing width would make the row invalid, the builder must either:
  - reject the change, or
  - automatically move the conflicting item into a new row

### 6.4 Preview behavior

The live preview must render directly from `layout_json`.
No separate preview-only layout logic.

---

## 7. Intake Builder Requirements

### 7.1 What stays the same

- Smartsheet-first field creation
- file-upload questions remain app-managed
- field editing remains separate from layout placement

### 7.2 What changes

Replace:

- per-field `layout_mode`
- lane-based drag target model

With:

- row-based layout canvas
- explicit rows with `full` or paired `half` items

### 7.3 Rendering

Public intake form renderer reads:

- section order
- row order
- item order
- item width

No inferred left/right placement from field metadata.

---

## 8. Reviewer Builder Requirements

### 8.1 What stays the same

- purpose mapping
- hidden-in-blind-review checkbox
- pinned header fields
- role permissions
- section support
- view type support

### 8.2 What changes

The reviewer builder should use the same row-based canvas inside each section.

Pinned fields remain separate from section rows.
They should not be part of the main row canvas.

### 8.3 View-type behavior

- `tabbed`: each tab renders one section's rows
- `stacked`: sections render top to bottom, each with its rows
- `accordion`: same row model inside each accordion panel
- `list_detail`: left list stays fixed; right detail pane renders the section rows

---

## 9. Validation Rules

The server must validate saved `layout_json`.

At minimum:

- every referenced `field_key` exists
- no field appears twice in the same layout
- every non-pinned field appears exactly once
- row item count is valid
- row width combinations are valid
- section keys referenced by layout exist

If layout validation fails, save must fail with a clear admin error.

---

## 10. Migration Strategy

### 10.1 Intake migration

Current intake forms with no explicit layout should be converted automatically:

- each field becomes its own row
- width defaults to `full`
- existing field order becomes row order

### 10.2 Reviewer migration

Current reviewer configs should be converted automatically:

- pinned fields remain pinned
- non-pinned fields become one full-width row each
- existing section assignment is preserved
- existing field order becomes row order

### 10.3 Backward compatibility

During rollout, loaders may read old layout metadata and normalize it into the new shape before rendering.

Once all editors save the new structure, old per-field layout flags should be treated as legacy only.

---

## 11. Definition Of Done

This refactor is complete when:

- intake builder and reviewer builder both save a row-based `layout_json`
- both builders use a consistent drag model
- public intake rendering reads the saved row model directly
- reviewer rendering reads the saved row model directly
- blind review, pinning, and permissions continue to work
- existing forms/configs migrate without manual rebuild

---

## 12. External Pattern Notes

This direction matches the general pattern used by mature form/detail builders:

- Jotform: columns are part of structured form layout, not free-floating field lanes
- Zoho Creator: fields are rearranged within explicit multi-column sections
- Airtable Interfaces: fields are placed above/below or next to other fields in a detail layout
- Aha custom layouts: draggable record layouts combine field placement with visibility/read-only rules

Reference links:

- https://www.jotform.com/help/423-setting-up-form-columns/
- https://www.jotform.com/help/how-to-group-your-form-fields/
- https://help.zoho.com/portal/en/kb/creator/developer-guide/forms/add-and-manage-fields/articles/rearrange-fields
- https://support.airtable.com/docs/es/airtable-interface-layout-record-detail
- https://www.aha.io/support/suite/suite/customizations/custom-layouts
