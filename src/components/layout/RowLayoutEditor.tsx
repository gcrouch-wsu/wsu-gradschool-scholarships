"use client";

import React from "react";
import type { DraftLayoutJson } from "@/lib/layout-editor";
import {
  addDraftRowToSection,
  assignFieldToDraftSlot,
  deleteDraftRow,
  getPlacedFieldKeys,
  moveDraftRow,
  reorderDraftRow,
  setDraftRowMode,
} from "@/lib/layout-editor";

interface FieldOption {
  field_key: string;
  label: string;
  badge?: string;
}

interface SectionOption {
  section_key: string;
  label: string;
  sort_order?: number | null;
}

export function RowLayoutEditor({
  layout,
  fields,
  sections,
  onChange,
  title,
  description,
}: {
  layout: DraftLayoutJson;
  fields: FieldOption[];
  sections: SectionOption[];
  onChange: (nextLayout: DraftLayoutJson) => void;
  title: string;
  description: string;
}) {
  const [draggingRow, setDraggingRow] = React.useState<{
    sectionKey: string;
    rowKey: string;
  } | null>(null);
  const placed = getPlacedFieldKeys(layout);
  const sortedSections = [...sections].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const fieldMap = new Map(fields.map((field) => [field.field_key, field]));
  const unplacedFields = fields.filter((field) => !placed.has(field.field_key));

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
      <p className="mt-1 text-sm text-zinc-600">{description}</p>

      <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Unplaced fields
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {unplacedFields.length > 0 ? (
            unplacedFields.map((field) => (
              <span
                key={field.field_key}
                className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-700"
              >
                {field.label}
                {field.badge ? ` (${field.badge})` : ""}
              </span>
            ))
          ) : (
            <span className="text-xs text-zinc-400">All fields are placed in the layout.</span>
          )}
        </div>
      </div>

      <div className="mt-4 space-y-4">
        {sortedSections.map((section) => {
          const layoutSection = layout.sections.find(
            (candidate) => candidate.section_key === section.section_key
          );
          return (
            <div key={section.section_key} className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-sm font-medium text-zinc-900">{section.label}</h4>
                  <p className="text-xs text-zinc-500">{section.section_key}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => onChange(addDraftRowToSection(layout, section.section_key, "full"))}
                    className="rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-white"
                  >
                    + Full row
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange(addDraftRowToSection(layout, section.section_key, "two_up"))}
                    className="rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-white"
                  >
                    + Two columns
                  </button>
                  <button
                    type="button"
                    onClick={() => onChange(addDraftRowToSection(layout, section.section_key, "three_up"))}
                    className="rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-white"
                  >
                    + Three columns
                  </button>
                </div>
              </div>

              <div className="mt-3 space-y-3">
                {(layoutSection?.rows ?? []).map((row, rowIndex) => {
                  const isDraggingRow = draggingRow?.rowKey === row.row_key;
                  const isSameSectionDrag = draggingRow?.sectionKey === section.section_key;
                  const isLastRow = rowIndex === (layoutSection?.rows.length ?? 1) - 1;

                  return (
                    <div
                      key={row.row_key}
                      onDragOver={(event) => {
                        if (!isSameSectionDrag) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(event) => {
                        if (!draggingRow || draggingRow.sectionKey !== section.section_key) return;
                        event.preventDefault();
                        onChange(
                          reorderDraftRow(layout, section.section_key, draggingRow.rowKey, rowIndex)
                        );
                        setDraggingRow(null);
                      }}
                      className={`rounded-lg border bg-white p-3 transition-colors ${
                        isDraggingRow ? "border-[var(--wsu-crimson)] shadow-sm" : "border-zinc-200"
                      }`}
                    >
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <div
                            draggable
                            onDragStart={(event) => {
                              setDraggingRow({
                                sectionKey: section.section_key,
                                rowKey: row.row_key,
                              });
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData("text/plain", row.row_key);
                            }}
                            onDragEnd={() => setDraggingRow(null)}
                            className="flex h-8 w-8 cursor-grab items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 text-zinc-400 hover:text-zinc-600 active:cursor-grabbing"
                            title="Drag to reorder row"
                            aria-label={`Drag row ${rowIndex + 1} to reorder`}
                          >
                            :::
                          </div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                            Row {rowIndex + 1}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="inline-flex rounded border border-zinc-300 bg-zinc-50 p-0.5 text-xs">
                            <button
                              type="button"
                              onClick={() => onChange(setDraftRowMode(layout, section.section_key, row.row_key, "full"))}
                              className={`rounded px-2 py-1 ${
                                row.mode === "full"
                                  ? "bg-white text-zinc-900 shadow-sm"
                                  : "text-zinc-600 hover:bg-white"
                              }`}
                            >
                              1 col
                            </button>
                            <button
                              type="button"
                              onClick={() => onChange(setDraftRowMode(layout, section.section_key, row.row_key, "two_up"))}
                              className={`rounded px-2 py-1 ${
                                row.mode === "two_up"
                                  ? "bg-white text-zinc-900 shadow-sm"
                                  : "text-zinc-600 hover:bg-white"
                              }`}
                            >
                              2 col
                            </button>
                            <button
                              type="button"
                              onClick={() => onChange(setDraftRowMode(layout, section.section_key, row.row_key, "three_up"))}
                              className={`rounded px-2 py-1 ${
                                row.mode === "three_up"
                                  ? "bg-white text-zinc-900 shadow-sm"
                                  : "text-zinc-600 hover:bg-white"
                              }`}
                            >
                              3 col
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => onChange(moveDraftRow(layout, section.section_key, row.row_key, -1))}
                            disabled={rowIndex === 0}
                            className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Up
                          </button>
                          <button
                            type="button"
                            onClick={() => onChange(moveDraftRow(layout, section.section_key, row.row_key, 1))}
                            disabled={isLastRow}
                            className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Down
                          </button>
                          <button
                            type="button"
                            onClick={() => onChange(deleteDraftRow(layout, section.section_key, row.row_key))}
                            className="rounded border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                          >
                            Delete row
                          </button>
                        </div>
                      </div>

                      <div
                        className={
                          row.mode === "three_up"
                            ? "grid gap-3 md:grid-cols-3"
                            : row.mode === "two_up"
                              ? "grid gap-3 md:grid-cols-2"
                              : "space-y-3"
                        }
                      >
                        {row.items.map((item, slotIndex) => {
                          const selectedField = item.field_key ? fieldMap.get(item.field_key) : null;
                          return (
                            <div key={item.item_key} className="rounded border border-zinc-200 bg-zinc-50 p-3">
                              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                                {row.mode === "three_up"
                                  ? `Column ${slotIndex + 1}`
                                  : row.mode === "two_up"
                                    ? slotIndex === 0
                                      ? "Left column"
                                      : "Right column"
                                    : "Full width"}
                              </div>
                              <select
                                value={item.field_key ?? ""}
                                onChange={(event) =>
                                  onChange(
                                    assignFieldToDraftSlot({
                                      layout,
                                      sectionKey: section.section_key,
                                      rowKey: row.row_key,
                                      slotIndex,
                                      fieldKey: event.target.value || null,
                                    })
                                  )
                                }
                                className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
                              >
                                <option value="">Select a field...</option>
                                {fields.map((field) => (
                                  <option key={field.field_key} value={field.field_key}>
                                    {field.label}
                                    {field.badge ? ` (${field.badge})` : ""}
                                  </option>
                                ))}
                              </select>
                              {selectedField && (
                                <p className="mt-2 text-xs text-zinc-500">
                                  {selectedField.label}
                                  {selectedField.badge ? ` - ${selectedField.badge}` : ""}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                {(layoutSection?.rows ?? []).length === 0 && (
                  <div className="rounded border border-dashed border-zinc-300 bg-white px-4 py-6 text-center text-sm text-zinc-400">
                    No rows yet. Add a full row, two-column row, or three-column row for this section.
                  </div>
                )}
                {(layoutSection?.rows ?? []).length > 1 && (
                  <p className="text-xs text-zinc-500">
                    Drag the row handle to reorder rows. Up and Down remain available for fine adjustment.
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
